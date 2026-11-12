import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/stripe.js', () => ({ stripe: {} }));
vi.mock('../src/lib/supabase.js', () => ({ supabase: {} }));
vi.mock('../src/repositories/product.js', () => ({ productRepository: {} }));
vi.mock('../src/repositories/customer.js', () => ({ customerRepository: {} }));
vi.mock('../src/repositories/provisioning.js', () => ({
	provisioningRepository: {},
}));

import { migrateSubscription } from '../scripts/migrate-legacy-addons.js';

const NOW = 1_792_000_000;
const stripe = {
	paymentMethods: { retrieve: vi.fn(), list: vi.fn() },
	subscriptions: { create: vi.fn() },
	subscriptionItems: { del: vi.fn() },
	invoices: { list: vi.fn(), voidInvoice: vi.fn() },
};

// Caso real: STARTER anual + "Vetores" mensal na mesma assinatura, com a
// fatura do complemento em aberto (a que derrubaria o plano).
const legacySub = {
	id: 'sub_plan',
	customer: 'cus_1',
	status: 'past_due',
	metadata: { plan_id: 'plan-1' },
	default_payment_method: 'pm_card',
	items: {
		data: [
			{
				id: 'si_plan',
				created: 100,
				price: { id: 'price_starter_year' },
				current_period_end: NOW + 200 * 86400,
			},
			{
				id: 'si_addon',
				created: 200,
				quantity: 1,
				price: { id: 'price_vetores_month' },
				current_period_end: NOW + 10 * 86400,
			},
		],
	},
} as unknown as Stripe.Subscription;

const addonOnlyInvoice = {
	id: 'in_addon',
	lines: {
		has_more: false,
		data: [
			{
				amount: 3048,
				parent: {
					subscription_item_details: { subscription_item: 'si_addon' },
				},
			},
		],
	},
};
const planInvoice = {
	id: 'in_plan',
	lines: {
		has_more: false,
		data: [
			{
				amount: 29900,
				parent: { subscription_item_details: { subscription_item: 'si_plan' } },
			},
			{
				amount: 2300,
				parent: {
					subscription_item_details: { subscription_item: 'si_addon' },
				},
			},
		],
	},
};

const deps = () => ({
	stripe: stripe as unknown as Stripe,
	findProductByStripePriceId: vi.fn(async (priceId: string) =>
		priceId === 'price_vetores_month'
			? { id: 'prod-vetores', isAddon: true }
			: { id: 'prod-starter', isAddon: false },
	),
	log: vi.fn(),
	now: () => NOW * 1000,
});

beforeEach(() => {
	vi.resetAllMocks();
	stripe.paymentMethods.retrieve.mockResolvedValue({
		id: 'pm_card',
		type: 'card',
	});
	stripe.invoices.list.mockResolvedValue({
		data: [addonOnlyInvoice, planInvoice],
	});
});

describe('migrateSubscription', () => {
	it('simulação: lista as ações e não muda nada no Stripe', async () => {
		const actions = await migrateSubscription(legacySub, deps(), false);

		expect(actions).toEqual([
			{
				kind: 'create_addon_subscription',
				itemId: 'si_addon',
				priceId: 'price_vetores_month',
			},
			{ kind: 'remove_item', itemId: 'si_addon' },
			{ kind: 'void_invoice', invoiceId: 'in_addon' },
		]);
		expect(stripe.subscriptions.create).not.toHaveBeenCalled();
		expect(stripe.subscriptionItems.del).not.toHaveBeenCalled();
		expect(stripe.invoices.voidInvoice).not.toHaveBeenCalled();
	});

	it('aplicando: complemento vira assinatura própria em trial até o já pago, sai do plano e a fatura só dele é anulada', async () => {
		await migrateSubscription(legacySub, deps(), true);

		expect(stripe.subscriptions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				customer: 'cus_1',
				items: [{ price: 'price_vetores_month', quantity: 1 }],
				default_payment_method: 'pm_card',
				trial_end: NOW + 10 * 86400,
				metadata: expect.objectContaining({
					kind: 'addon',
					addon_product_id: 'prod-vetores',
					plan_subscription_id: 'sub_plan',
				}),
			}),
			{ idempotencyKey: 'addon-migration:si_addon' },
		);
		expect(stripe.subscriptionItems.del).toHaveBeenCalledWith('si_addon', {
			proration_behavior: 'none',
		});
		// Só a fatura do complemento; a que cobra o plano fica como está.
		expect(stripe.invoices.voidInvoice).toHaveBeenCalledTimes(1);
		expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith('in_addon');
	});

	it('sem cartão: só tira o item do plano e anula a fatura dele', async () => {
		stripe.paymentMethods.retrieve.mockResolvedValue({
			id: 'pm_boleto',
			type: 'boleto',
		});
		stripe.paymentMethods.list.mockResolvedValue({ data: [] });

		const actions = await migrateSubscription(legacySub, deps(), true);

		expect(stripe.subscriptions.create).not.toHaveBeenCalled();
		expect(stripe.subscriptionItems.del).toHaveBeenCalledWith('si_addon', {
			proration_behavior: 'none',
		});
		expect(actions[0]).toMatchObject({ kind: 'skip' });
	});

	it('não mexe em item extra que não é complemento', async () => {
		const d = deps();
		d.findProductByStripePriceId.mockResolvedValue({
			id: 'prod-x',
			isAddon: false,
		});

		expect(await migrateSubscription(legacySub, d, true)).toEqual([]);
		expect(stripe.subscriptionItems.del).not.toHaveBeenCalled();
	});

	it('ignora assinaturas que já são de complemento', async () => {
		const sub = {
			...legacySub,
			metadata: { kind: 'addon' },
		} as unknown as Stripe.Subscription;
		expect(await migrateSubscription(sub, deps(), true)).toEqual([]);
	});
});
