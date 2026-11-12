import { beforeEach, describe, expect, it, vi } from 'vitest';

// Complemento ("Vetores") pendurado como item na assinatura ANUAL do plano:
// o boleto mensal dele venceu e o Stripe cancelou o plano inteiro (aluno
// perdeu um anual pago). Agora o complemento é uma assinatura própria,
// cobrada no cartão na hora.

const stripe = vi.hoisted(() => ({
	customers: { list: vi.fn(), retrieve: vi.fn() },
	subscriptions: {
		list: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		cancel: vi.fn(),
	},
	prices: { create: vi.fn() },
	subscriptionItems: { del: vi.fn() },
	paymentMethods: { retrieve: vi.fn(), list: vi.fn() },
}));
const productRepository = vi.hoisted(() => ({
	findAddonById: vi.fn(),
	findByStripePriceId: vi.fn(),
}));

vi.mock('../src/lib/stripe.js', () => ({ stripe }));
vi.mock('../src/lib/supabase.js', () => ({ supabase: {} }));
vi.mock('../src/lib/sentry.js', () => ({
	withCapture: async <T>(fn: () => Promise<T>) => {
		try {
			return { data: await fn(), error: null };
		} catch (error) {
			return { data: null, error };
		}
	},
}));
vi.mock('../src/repositories/product.js', () => ({ productRepository }));
vi.mock('../src/repositories/customer.js', () => ({ customerRepository: {} }));
vi.mock('../src/repositories/provisioning.js', () => ({
	provisioningRepository: {},
}));

import {
	ADDON_SUBSCRIPTION_KIND,
	AddonPaymentMethodError,
	purchaseService,
} from '../src/services/purchase.js';

const planSub = {
	id: 'sub_plan',
	customer: 'cus_1',
	status: 'active',
	metadata: { plan_id: 'plan-1' },
	cancel_at_period_end: false,
	default_payment_method: 'pm_card',
	items: {
		data: [
			{
				id: 'si_plan',
				created: 100,
				price: { id: 'price_plan_year' },
				current_period_end: 2_000_000_000,
			},
		],
	},
};
const addonProduct = {
	id: 'prod-vetores',
	name: 'Vetores',
	isAddon: true,
	stripePriceId: 'price_vetores_month',
};
const addonSub = (overrides: Record<string, unknown> = {}) => ({
	id: 'sub_addon',
	customer: 'cus_1',
	status: 'active',
	cancel_at_period_end: false,
	metadata: {
		kind: ADDON_SUBSCRIPTION_KIND,
		addon_product_id: 'prod-vetores',
	},
	items: {
		data: [
			{ id: 'si_addon', created: 200, price: { id: 'price_vetores_month' } },
		],
	},
	...overrides,
});

/** `subscriptions.list` por status: active/trialing (plano) e all (complementos). */
function mockSubscriptions({
	active = [planSub],
	all = [] as unknown[],
}: {
	active?: unknown[];
	all?: unknown[];
} = {}) {
	stripe.subscriptions.list.mockImplementation(
		async ({ status }: { status: string }) => ({
			data: status === 'active' ? active : status === 'all' ? all : [],
		}),
	);
}

beforeEach(() => {
	vi.resetAllMocks();
	stripe.customers.list.mockResolvedValue({ data: [{ id: 'cus_1' }] });
	stripe.customers.retrieve.mockResolvedValue({
		id: 'cus_1',
		invoice_settings: { default_payment_method: null },
	});
	productRepository.findAddonById.mockResolvedValue(addonProduct);
	productRepository.findByStripePriceId.mockImplementation(
		async (priceId: string) =>
			priceId === 'price_vetores_month'
				? addonProduct
				: { id: 'prod-plan', name: 'STARTER', isAddon: false },
	);
});

describe('addAddon', () => {
	it('cria uma assinatura PRÓPRIA, cobrada no cartão na hora — nunca mexe na do plano', async () => {
		mockSubscriptions();
		stripe.paymentMethods.retrieve.mockResolvedValue({
			id: 'pm_card',
			type: 'card',
		});
		stripe.subscriptions.create.mockResolvedValue(addonSub());

		const { data, error } = await purchaseService.addAddon(
			'aluno@x.com',
			'prod-vetores',
		);

		expect(error).toBeNull();
		expect(stripe.subscriptions.update).not.toHaveBeenCalled();
		expect(stripe.subscriptions.create).toHaveBeenCalledWith(
			{
				customer: 'cus_1',
				items: [{ price: 'price_vetores_month', quantity: 1 }],
				default_payment_method: 'pm_card',
				collection_method: 'charge_automatically',
				payment_behavior: 'error_if_incomplete',
				payment_settings: { payment_method_types: ['card'] },
				metadata: {
					kind: ADDON_SUBSCRIPTION_KIND,
					addon_product_id: 'prod-vetores',
					plan_subscription_id: 'sub_plan',
				},
			},
			{
				idempotencyKey: expect.stringMatching(/^addon:cus_1:prod-vetores:\d+$/),
			},
		);
		expect(data).toMatchObject({
			subscriptionId: 'sub_addon',
			itemId: 'si_addon',
			productName: 'Vetores',
		});
	});

	it('plano pago por boleto e sem cartão: recusa com mensagem clara e não cria nada', async () => {
		mockSubscriptions({
			active: [{ ...planSub, default_payment_method: 'pm_boleto' }],
		});
		stripe.paymentMethods.retrieve.mockResolvedValue({
			id: 'pm_boleto',
			type: 'boleto',
		});
		stripe.paymentMethods.list.mockResolvedValue({ data: [] });

		const { error } = await purchaseService.addAddon(
			'aluno@x.com',
			'prod-vetores',
		);

		expect(error).toBeInstanceOf(AddonPaymentMethodError);
		expect(stripe.subscriptions.create).not.toHaveBeenCalled();
		expect(stripe.subscriptions.update).not.toHaveBeenCalled();
	});

	it('plano no boleto mas cliente com cartão salvo: usa o cartão', async () => {
		mockSubscriptions({
			active: [{ ...planSub, default_payment_method: 'pm_boleto' }],
		});
		stripe.paymentMethods.retrieve.mockResolvedValue({
			id: 'pm_boleto',
			type: 'boleto',
		});
		stripe.paymentMethods.list.mockResolvedValue({
			data: [{ id: 'pm_card_2', type: 'card' }],
		});
		stripe.subscriptions.create.mockResolvedValue(addonSub());

		await purchaseService.addAddon('aluno@x.com', 'prod-vetores');

		expect(stripe.subscriptions.create).toHaveBeenCalledWith(
			expect.objectContaining({ default_payment_method: 'pm_card_2' }),
			expect.anything(),
		);
	});

	it('cartão recusado: o erro do Stripe volta e nada fica pendurado', async () => {
		mockSubscriptions();
		stripe.paymentMethods.retrieve.mockResolvedValue({
			id: 'pm_card',
			type: 'card',
		});
		const declined = Object.assign(new Error('Your card was declined.'), {
			type: 'StripeCardError',
		});
		stripe.subscriptions.create.mockRejectedValue(declined);

		const { error } = await purchaseService.addAddon(
			'aluno@x.com',
			'prod-vetores',
		);

		expect(error).toBe(declined);
		expect(stripe.subscriptions.update).not.toHaveBeenCalled();
	});

	it('complemento já ativo: recusa em duplicidade', async () => {
		mockSubscriptions({ active: [planSub, addonSub()], all: [addonSub()] });

		const { error } = await purchaseService.addAddon(
			'aluno@x.com',
			'prod-vetores',
		);

		expect((error as Error).message).toBe(
			'Addon already attached to subscription',
		);
		expect(stripe.subscriptions.create).not.toHaveBeenCalled();
	});

	it('assinatura migrada sem id do produto na metadata: duplicado reconhecido pelo preço', async () => {
		const migrated = addonSub({
			metadata: { kind: ADDON_SUBSCRIPTION_KIND, migrated_from_item: 'si_old' },
		});
		mockSubscriptions({ active: [planSub, migrated], all: [migrated] });

		const { error } = await purchaseService.addAddon(
			'aluno@x.com',
			'prod-vetores',
		);

		expect((error as Error).message).toBe(
			'Addon already attached to subscription',
		);
		expect(stripe.subscriptions.create).not.toHaveBeenCalled();
	});

	it('complemento legado (item no plano): também conta como duplicado', async () => {
		const legacyPlan = {
			...planSub,
			items: {
				data: [
					...planSub.items.data,
					{ id: 'si_old', created: 300, price: { id: 'price_vetores_month' } },
				],
			},
		};
		mockSubscriptions({ active: [legacyPlan] });

		const { error } = await purchaseService.addAddon(
			'aluno@x.com',
			'prod-vetores',
		);

		expect((error as Error).message).toBe(
			'Addon already attached to subscription',
		);
	});

	it('complemento removido mas ainda no período pago: reativa em vez de cobrar de novo', async () => {
		const pending = addonSub({ cancel_at_period_end: true });
		mockSubscriptions({ active: [planSub, pending], all: [pending] });
		stripe.subscriptions.update.mockResolvedValue(addonSub());

		await purchaseService.addAddon('aluno@x.com', 'prod-vetores');

		expect(stripe.subscriptions.create).not.toHaveBeenCalled();
		expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_addon', {
			cancel_at_period_end: false,
		});
	});

	it('assinatura do complemento listada antes da do plano: ainda acha o plano', async () => {
		mockSubscriptions({ active: [addonSub(), planSub], all: [] });
		stripe.paymentMethods.retrieve.mockResolvedValue({
			id: 'pm_card',
			type: 'card',
		});
		stripe.subscriptions.create.mockResolvedValue(addonSub());

		await purchaseService.addAddon('aluno@x.com', 'prod-vetores');

		expect(stripe.subscriptions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ plan_subscription_id: 'sub_plan' }),
			}),
			expect.anything(),
		);
	});
});

describe('removeAddon', () => {
	it('complemento novo: para de renovar no fim do período, sem tocar no plano', async () => {
		mockSubscriptions({ all: [addonSub()] });

		const { data } = await purchaseService.removeAddon(
			'aluno@x.com',
			'si_addon',
		);

		expect(data).toEqual({ removed: true, itemId: 'si_addon' });
		expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_addon', {
			cancel_at_period_end: true,
		});
		expect(stripe.subscriptionItems.del).not.toHaveBeenCalled();
	});

	it('complemento legado (item no plano): remove o item como antes', async () => {
		const legacyPlan = {
			...planSub,
			items: {
				data: [
					...planSub.items.data,
					{ id: 'si_old', created: 300, price: { id: 'price_vetores_month' } },
				],
			},
		};
		mockSubscriptions({ active: [legacyPlan] });

		await purchaseService.removeAddon('aluno@x.com', 'si_old');

		expect(stripe.subscriptionItems.del).toHaveBeenCalledWith('si_old', {
			proration_behavior: 'create_prorations',
		});
	});

	it('não deixa remover o item do plano', async () => {
		mockSubscriptions();

		const { error } = await purchaseService.removeAddon(
			'aluno@x.com',
			'si_plan',
		);

		expect((error as Error).message).toBe('Cannot remove the main plan item');
		expect(stripe.subscriptionItems.del).not.toHaveBeenCalled();
	});
});

describe('listAddons', () => {
	it('junta complementos novos e legados, sem os que já foram removidos', async () => {
		const legacyPlan = {
			...planSub,
			items: {
				data: [
					...planSub.items.data,
					{ id: 'si_old', created: 300, price: { id: 'price_vetores_month' } },
				],
			},
		};
		const removed = addonSub({ id: 'sub_removed', cancel_at_period_end: true });
		mockSubscriptions({ active: [legacyPlan], all: [addonSub(), removed] });

		const { data } = await purchaseService.listAddons('aluno@x.com');

		expect(data?.map((a) => a.itemId)).toEqual(['si_old', 'si_addon']);
	});
});

describe('rotas do plano ignoram a assinatura do complemento', () => {
	it('cancelSubscription cancela o PLANO, não o complemento listado antes', async () => {
		mockSubscriptions({ active: [addonSub(), planSub] });
		stripe.subscriptions.update.mockResolvedValue({
			...planSub,
			cancel_at_period_end: true,
		});

		await purchaseService.cancelSubscription('aluno@x.com');

		expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_plan', {
			cancel_at_period_end: true,
		});
	});

	it('listActiveSubscriptions não mostra o complemento como plano', async () => {
		mockSubscriptions({ active: [addonSub(), planSub] });

		const { data } =
			await purchaseService.listActiveSubscriptions('aluno@x.com');

		expect(data?.map((s) => s.id)).toEqual(['sub_plan']);
	});
});

describe('createSubscription (troca de plano pelo admin)', () => {
	it('cancela a assinatura antiga do PLANO, mas não as de complemento', async () => {
		stripe.customers.list.mockResolvedValue({ data: [{ id: 'cus_1' }] });
		stripe.subscriptions.list.mockResolvedValue({
			data: [planSub, addonSub()],
		});
		stripe.subscriptions.cancel.mockResolvedValue({});
		// Para logo depois dos cancelamentos: o resto do fluxo não interessa aqui.
		stripe.prices.create.mockRejectedValue(new Error('stop'));

		await purchaseService.createSubscription({
			email: 'aluno@x.com',
			stripeProductId: 'prod_x',
			amount: 10,
		} as never);

		expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
		expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_plan');
	});
});
