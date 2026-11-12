/**
 * Migra complementos LEGADOS: itens pendurados na assinatura do plano (como o
 * `addAddon` antigo fazia) viram assinaturas próprias (`metadata.kind='addon'`),
 * para que a cobrança deles nunca mais derrube o plano.
 *
 * Por assinatura de plano com itens extras:
 *  1. cria a assinatura do complemento no cartão do aluno, em trial até o fim
 *     do período que o item já cobria (sem cobrar de novo);
 *  2. remove o item da assinatura do plano, sem proração;
 *  3. anula faturas em aberto que só cobram complemento (as que levariam o
 *     Stripe a cancelar o plano inteiro).
 * Aluno sem cartão: o item só é removido (e a fatura anulada) — o complemento
 * não volta sozinho, ele pode adicioná-lo de novo pelo cartão.
 *
 * Padrão é SIMULAÇÃO (não muda nada). Para aplicar:
 *   npx tsx --env-file=.env scripts/migrate-legacy-addons.ts --apply
 * Sem acesso ao banco de produtos, informe os preços de complemento:
 *   ... scripts/migrate-legacy-addons.ts --addon-price=price_x --apply
 */
import type Stripe from 'stripe';
import { ADDON_SUBSCRIPTION_KIND } from '../src/services/purchase.js';

/** `id` é opcional: sem banco (`--addon-price`), o preço identifica o complemento. */
type AddonProduct = { id?: string; isAddon?: boolean } | null;

export type MigrationDeps = {
	stripe: Stripe;
	findProductByStripePriceId: (priceId: string) => Promise<AddonProduct>;
	log: (line: string) => void;
	now?: () => number;
};

export type MigrationAction =
	| { kind: 'create_addon_subscription'; itemId: string; priceId: string }
	| { kind: 'remove_item'; itemId: string }
	| { kind: 'void_invoice'; invoiceId: string }
	| { kind: 'skip'; reason: string };

const idOf = (ref: string | { id: string } | null | undefined) =>
	typeof ref === 'string' ? ref : (ref?.id ?? null);

function planItemOf(sub: Stripe.Subscription) {
	return sub.items.data.reduce<Stripe.SubscriptionItem | undefined>(
		(oldest, item) =>
			!oldest || (item.created ?? 0) < (oldest.created ?? 0) ? item : oldest,
		undefined,
	);
}

async function findCard(
	stripe: Stripe,
	sub: Stripe.Subscription,
	customerId: string,
): Promise<string | null> {
	const candidate = idOf(sub.default_payment_method);
	if (candidate) {
		const pm = await stripe.paymentMethods.retrieve(candidate);
		if (pm.type === 'card') return pm.id;
	}
	const cards = await stripe.paymentMethods.list({
		customer: customerId,
		type: 'card',
		limit: 1,
	});
	return cards.data[0]?.id ?? null;
}

/** Migra uma assinatura de plano. Devolve as ações (feitas ou simuladas). */
export async function migrateSubscription(
	sub: Stripe.Subscription,
	deps: MigrationDeps,
	apply: boolean,
): Promise<MigrationAction[]> {
	const { stripe } = deps;
	const now = Math.floor((deps.now ?? Date.now)() / 1000);
	const plan = planItemOf(sub);
	if (!plan || sub.metadata?.kind === ADDON_SUBSCRIPTION_KIND) return [];

	const extras: { item: Stripe.SubscriptionItem; productId?: string }[] = [];
	for (const item of sub.items.data) {
		if (item.id === plan.id) continue;
		const product = await deps.findProductByStripePriceId(item.price.id);
		// Só mexe no que é complemento de verdade.
		if (product?.isAddon) extras.push({ item, productId: product.id });
	}
	if (extras.length === 0) return [];

	const customerId = idOf(sub.customer) as string;
	const card = await findCard(stripe, sub, customerId);
	const actions: MigrationAction[] = [];
	const extraIds = new Set(extras.map((e) => e.item.id));

	for (const { item, productId } of extras) {
		if (card) {
			actions.push({
				kind: 'create_addon_subscription',
				itemId: item.id,
				priceId: item.price.id,
			});
			if (apply) {
				const paidUntil = item.current_period_end;
				await stripe.subscriptions.create(
					{
						customer: customerId,
						items: [{ price: item.price.id, quantity: item.quantity ?? 1 }],
						default_payment_method: card,
						collection_method: 'charge_automatically',
						payment_settings: { payment_method_types: ['card'] },
						...(paidUntil > now + 60 ? { trial_end: paidUntil } : {}),
						metadata: {
							kind: ADDON_SUBSCRIPTION_KIND,
							...(productId ? { addon_product_id: productId } : {}),
							plan_subscription_id: sub.id,
							migrated_from_item: item.id,
						},
					},
					{ idempotencyKey: `addon-migration:${item.id}` },
				);
			}
		} else {
			actions.push({
				kind: 'skip',
				reason: `sem cartão: ${item.price.id} só é removido`,
			});
		}

		actions.push({ kind: 'remove_item', itemId: item.id });
		if (apply)
			await stripe.subscriptionItems.del(item.id, {
				proration_behavior: 'none',
			});
	}

	const open = await stripe.invoices.list({
		subscription: sub.id,
		status: 'open',
		limit: 100,
	});
	for (const invoice of open.data) {
		const charged = invoice.lines.data.filter((l) => l.amount > 0);
		const onlyAddon =
			charged.length > 0 &&
			!invoice.lines.has_more &&
			charged.every((l) => {
				const itemId = l.parent?.subscription_item_details?.subscription_item;
				return !!itemId && extraIds.has(itemId);
			});
		if (!onlyAddon || !invoice.id) continue;
		actions.push({ kind: 'void_invoice', invoiceId: invoice.id });
		if (apply) await stripe.invoices.voidInvoice(invoice.id);
	}

	return actions;
}

export async function migrateAll(deps: MigrationDeps, apply: boolean) {
	const summary = { subscriptions: 0, actions: 0 };
	for (const status of ['active', 'trialing', 'past_due'] as const) {
		for await (const sub of deps.stripe.subscriptions.list({
			status,
			limit: 100,
		})) {
			if (sub.items.data.length < 2) continue;
			const actions = await migrateSubscription(sub, deps, apply);
			if (actions.length === 0) continue;
			summary.subscriptions++;
			summary.actions += actions.length;
			deps.log(
				`${apply ? 'APLICADO' : 'SIMULADO'} ${sub.id} (${sub.status}): ${actions
					.map((a) =>
						a.kind === 'skip'
							? `skip[${a.reason}]`
							: `${a.kind}[${'itemId' in a ? a.itemId : a.invoiceId}]`,
					)
					.join(', ')}`,
			);
		}
	}
	deps.log(
		`${summary.subscriptions} assinatura(s), ${summary.actions} ação(ões) ${apply ? 'aplicadas' : 'simuladas — rode com --apply para aplicar'}.`,
	);
	return summary;
}

/**
 * `--addon-price=price_x` (repetível): diz quais preços são complemento sem
 * consultar o banco de produtos — para rodar só com a chave do Stripe.
 */
export function addonPricesFromArgs(argv: string[]): Set<string> {
	return new Set(
		argv
			.filter((a) => a.startsWith('--addon-price='))
			.map((a) => a.slice('--addon-price='.length))
			.filter(Boolean),
	);
}

if (process.argv[1]?.endsWith('migrate-legacy-addons.ts')) {
	const { stripe } = await import('../src/lib/stripe.js');
	const addonPrices = addonPricesFromArgs(process.argv);
	const findProductByStripePriceId =
		addonPrices.size > 0
			? async (priceId: string): Promise<AddonProduct> => ({
					isAddon: addonPrices.has(priceId),
				})
			: async (priceId: string): Promise<AddonProduct> => {
					const { productRepository } = await import(
						'../src/repositories/product.js'
					);
					return productRepository
						.findByStripePriceId(priceId)
						.catch(() => null);
				};
	await migrateAll(
		{ stripe, findProductByStripePriceId, log: (line) => console.log(line) },
		process.argv.includes('--apply'),
	);
}
