import type Stripe from 'stripe';
import { withCapture } from '@/lib/sentry.js';
import { stripe } from '../lib/stripe.js';
import { customerRepository } from '../repositories/customer.js';
import { productRepository } from '../repositories/product.js';
import { provisioningRepository } from '../repositories/provisioning.js';
import type { ProvisioningPlan } from '../types/provisioning.js';
import { PLAN_ORDER, resolvePlanFromProduct } from '../utils/plan.js';
import { resolveSuccessUrl } from '../utils/success-url.js';

async function findActiveStripeSubscription(email: string) {
	const customers = await stripe.customers.list({ email, limit: 1 });
	if (!customers.data.length) throw new Error('No Stripe customer found');
	const customerId = customers.data[0].id;

	const [activeSubs, trialingSubs] = await Promise.all([
		stripe.subscriptions.list({
			customer: customerId,
			status: 'active',
			limit: 1,
		}),
		stripe.subscriptions.list({
			customer: customerId,
			status: 'trialing',
			limit: 1,
		}),
	]);
	const subscription = activeSubs.data[0] ?? trialingSubs.data[0];
	if (!subscription)
		throw new Error('No active or trialing Stripe subscription found');
	return subscription;
}

export const purchaseService = {
	async listPurchases(email: string) {
		return withCapture(async () => {
			const customers = await stripe.customers.list({ email, limit: 1 });

			if (customers.data.length === 0) {
				return [];
			}

			const customerId = customers.data[0].id;

			const sessions = await stripe.checkout.sessions.list({
				customer: customerId,
				status: 'complete',
				expand: ['data.line_items'],
			});

			return sessions.data.map((session) => {
				const item = session.line_items?.data[0];
				return {
					id: session.id,
					date: new Date(session.created * 1000).toISOString(),
					amount: session.amount_total ? session.amount_total / 100 : 0,
					currency: session.currency,
					status: session.payment_status,
					product: item?.description || 'Unknown Product',
					receipt_url: session.url,
				};
			});
		});
	},

	async listAllPurchases() {
		return withCapture(async () => {
			const charges: Stripe.Charge[] = [];
			for await (const charge of stripe.charges.list({
				limit: 100,
				expand: ['data.customer'],
			})) {
				if (charge.status === 'succeeded') charges.push(charge);
			}

			const chargeIdToProduct = new Map<string, string>();
			const productIdToName = new Map<string, string>();
			for await (const invoice of stripe.invoices.list({
				limit: 100,
				status: 'paid',
				expand: ['data.payments'],
			})) {
				const line = invoice.lines?.data[0];
				const productRef = line?.pricing?.price_details?.product;
				if (!productRef) continue;
				let productName = productIdToName.get(productRef);
				if (!productName) {
					try {
						const p = await stripe.products.retrieve(productRef);
						productName = p.name;
						productIdToName.set(productRef, productName);
					} catch {
						continue;
					}
				}
				for (const p of invoice.payments?.data ?? []) {
					const ch = p.payment?.charge;
					const chId = typeof ch === 'string' ? ch : ch?.id;
					if (chId) chargeIdToProduct.set(chId, productName);
					const pi = p.payment?.payment_intent;
					const piId = typeof pi === 'string' ? pi : pi?.id;
					if (piId) chargeIdToProduct.set(piId, productName);
				}
			}

			const emails = charges
				.map((c) => {
					const customer = c.customer as Stripe.Customer | null;
					return customer?.email ?? c.billing_details?.email ?? null;
				})
				.filter(Boolean) as string[];

			const [dbPhones, dbNames] = await Promise.all([
				customerRepository.findPhonesByEmails(emails),
				provisioningRepository.findNamesByEmails(emails),
			]);

			const getProductName = (c: Stripe.Charge) => {
				const piId =
					typeof c.payment_intent === 'string'
						? c.payment_intent
						: c.payment_intent?.id;
				const fromInvoice =
					chargeIdToProduct.get(c.id) ??
					(piId ? chargeIdToProduct.get(piId) : undefined);
				if (fromInvoice) return fromInvoice;
				if (
					c.description &&
					c.description !== 'Subscription update' &&
					c.description !== 'Subscription creation'
				) {
					return c.description;
				}
				return 'Unknown Product';
			};

			const counters = new Map<string, number>();
			const sorted = [...charges].sort((a, b) => a.created - b.created);
			const monthMap = new Map<string, number>();
			for (const c of sorted) {
				const customer = c.customer as Stripe.Customer | null;
				const email = customer?.email || c.billing_details?.email || '';
				const key = `${email}||${getProductName(c)}`;
				const next = (counters.get(key) ?? 0) + 1;
				counters.set(key, next);
				monthMap.set(c.id, next);
			}

			return charges.map((charge) => {
				const customer = charge.customer as Stripe.Customer | null;
				const email = customer?.email || charge.billing_details?.email || '';

				return {
					id: charge.id,
					date: new Date(charge.created * 1000).toISOString(),
					amount: charge.amount ? charge.amount / 100 : 0,
					currency: charge.currency,
					status: charge.refunded
						? 'reembolsado'
						: (charge.status ?? 'unknown'),
					subscriptionMonth: monthMap.get(charge.id) ?? 1,
					product: getProductName(charge),
					customer: {
						name:
							customer?.name ||
							charge.billing_details?.name ||
							dbNames[email] ||
							'Unknown',
						email: email || 'No email',
						phone:
							customer?.phone ||
							charge.billing_details?.phone ||
							dbPhones[email] ||
							null,
					},
					receipt_url: charge.receipt_url ?? null,
				};
			});
		});
	},

	async createRefund(data: { chargeId: string; email: string }) {
		return withCapture(async () => {
			const charge = await stripe.charges.retrieve(data.chargeId, {
				expand: ['customer'],
			});
			if (!charge) throw new Error('Charge not found');
			if (charge.status !== 'succeeded')
				throw new Error('Charge is not refundable');
			if (charge.refunded) throw new Error('Charge already refunded');

			const customer = charge.customer as Stripe.Customer | null;
			const chargeEmail = customer?.email ?? charge.billing_details?.email;
			if (chargeEmail && chargeEmail !== data.email) {
				throw new Error('Charge does not belong to this customer');
			}

			const refund = await stripe.refunds.create({ charge: data.chargeId });

			return {
				id: refund.id,
				chargeId: data.chargeId,
				amount: refund.amount / 100,
				currency: refund.currency,
				status: refund.status ?? 'unknown',
				reason: refund.reason ?? null,
			};
		});
	},

	async listRefunds(options?: { limit?: number; starting_after?: string }) {
		return withCapture(async () => {
			const refunds = await stripe.refunds.list({
				limit: options?.limit ?? 50,
				...(options?.starting_after && {
					starting_after: options.starting_after,
				}),
			});

			const chargeIds = refunds.data
				.map((r) => (typeof r.charge === 'string' ? r.charge : null))
				.filter(Boolean) as string[];

			const charges = await Promise.all(
				chargeIds.map((id) =>
					stripe.charges.retrieve(id, {
						expand: ['customer'],
					}),
				),
			);

			const chargeMap = new Map(charges.map((c) => [c.id, c]));

			const emails = charges
				.map((c) => {
					// biome-ignore lint/suspicious/noExplicitAny: Stripe expanded customer
					const customer = c.customer as any;
					return customer?.email || c.billing_details?.email;
				})
				.filter(Boolean) as string[];

			const [dbPhones, dbNames] = await Promise.all([
				customerRepository.findPhonesByEmails(emails),
				provisioningRepository.findNamesByEmails(emails),
			]);

			return refunds.data.map((refund) => {
				const chargeId =
					typeof refund.charge === 'string' ? refund.charge : null;
				const charge = chargeId ? chargeMap.get(chargeId) : null;
				// biome-ignore lint/suspicious/noExplicitAny: Stripe expanded customer
				const customer = charge?.customer as any;
				const email = customer?.email || charge?.billing_details?.email || '';

				return {
					id: refund.id,
					date: new Date(refund.created * 1000).toISOString(),
					amount: refund.amount / 100,
					currency: refund.currency,
					status: refund.status ?? 'unknown',
					reason: refund.reason ?? null,
					charge_id: chargeId,
					customer: {
						name: customer?.name || dbNames[email] || 'Unknown',
						email: email || 'No email',
						phone: customer?.phone || dbPhones[email] || null,
					},
				};
			});
		});
	},

	async listPaymentAttempts(options?: {
		status?: 'succeeded' | 'failed' | 'all';
		limit?: number;
		starting_after?: string;
	}) {
		return withCapture(async () => {
			const statusFilter = options?.status;
			const limit = options?.limit ?? 50;

			const stripeStatus =
				statusFilter === 'succeeded'
					? 'succeeded'
					: statusFilter === 'failed'
						? 'requires_payment_method'
						: undefined;

			const intents = await stripe.paymentIntents.list({
				limit,
				...(options?.starting_after && {
					starting_after: options.starting_after,
				}),
				...(stripeStatus && { status: stripeStatus }),
				expand: ['data.customer', 'data.latest_charge'],
			});

			const emails = intents.data
				.map((i) => {
					const c = i.customer as Stripe.Customer | null;
					const charge = i.latest_charge as Stripe.Charge | null;
					return c?.email ?? charge?.billing_details?.email;
				})
				.filter(Boolean) as string[];

			const dbPhones = await customerRepository.findPhonesByEmails(emails);

			return intents.data.map((intent) => {
				const customer = intent.customer as Stripe.Customer | null;
				const charge = intent.latest_charge as Stripe.Charge | null;

				const resolvedStatus =
					intent.status === 'succeeded'
						? 'succeeded'
						: intent.status === 'requires_payment_method' ||
								intent.status === 'canceled'
							? 'failed'
							: intent.status;

				const email = customer?.email ?? charge?.billing_details?.email ?? '';

				return {
					id: intent.id,
					date: new Date(intent.created * 1000).toISOString(),
					amount: intent.amount / 100,
					currency: intent.currency,
					status: resolvedStatus,
					failure_message: intent.last_payment_error?.message ?? null,
					product:
						intent.description ?? charge?.description ?? 'Unknown Product',
					customer: {
						name: customer?.name ?? charge?.billing_details?.name ?? 'Unknown',
						email: email || 'No email',
						phone:
							customer?.phone ??
							charge?.billing_details?.phone ??
							dbPhones[email] ??
							null,
					},
					receipt_url: charge?.receipt_url ?? null,
				};
			});
		});
	},

	async createSubscription(data: {
		email: string;
		stripeProductId: string;
		amount: number;
		interval: 'month' | 'year';
		intervalCount: number;
		endsAt: string;
	}) {
		return withCapture(async () => {
			const existing = await stripe.customers.list({
				email: data.email,
				limit: 1,
			});

			const customer =
				existing.data.length > 0
					? existing.data[0]
					: await stripe.customers.create({ email: data.email });

			const existingSubs = await stripe.subscriptions.list({
				customer: customer.id,
				status: 'active',
				limit: 100,
			});
			await Promise.all(
				existingSubs.data.map((sub) => stripe.subscriptions.cancel(sub.id)),
			);

			const price = await stripe.prices.create({
				product: data.stripeProductId,
				unit_amount: Math.round(data.amount * 100),
				currency: 'brl',
				recurring: {
					interval: data.interval,
					interval_count: data.intervalCount,
				},
			});

			const subscription = await stripe.subscriptions.create({
				customer: customer.id,
				items: [{ price: price.id }],
				cancel_at: Math.floor(new Date(data.endsAt).getTime() / 1000),
				collection_method: 'send_invoice',
				days_until_due: 30,
			});

			return {
				id: subscription.id,
				status: subscription.status,
				customerId: customer.id,
				email: data.email,
				amount: data.amount,
				interval: data.interval,
				intervalCount: data.intervalCount,
				endsAt: data.endsAt,
			};
		});
	},

	async createPurchase(data: {
		email: string;
		productId: string;
		companyName?: string;
		phone?: string;
	}) {
		return withCapture(async () => {
			const product = await productRepository.findById(data.productId);

			if (!product.stripePriceId) {
				throw new Error('Product is not configured for payments');
			}

			const stripePrice = await stripe.prices.retrieve(product.stripePriceId);
			const mode = stripePrice.recurring ? 'subscription' : 'payment';

			const normalizedPhone = data.phone
				? data.phone.startsWith('+')
					? data.phone
					: `+55${data.phone.replace(/\D/g, '')}`
				: undefined;

			const existing = await stripe.customers.list({
				email: data.email,
				limit: 1,
			});
			const customer =
				existing.data.length > 0
					? existing.data[0]
					: await stripe.customers.create({
							email: data.email,
							...(normalizedPhone && { phone: normalizedPhone }),
						});

			const successUrl = await resolveSuccessUrl(data.productId);

			const session = await stripe.checkout.sessions.create({
				customer: customer.id,
				line_items: [{ price: product.stripePriceId, quantity: 1 }],
				mode,
				payment_method_types: ['card', 'boleto'],
				success_url: successUrl,
				cancel_url: process.env.CANCEL_URL ?? 'http://localhost:3000/cancelado',
				...(data.companyName && {
					metadata: { company_name: data.companyName },
				}),
			});

			return {
				id: session.id,
				checkoutUrl: session.url,
				status: session.status,
				productName: product.name,
			};
		});
	},

	async changePlan(
		email: string,
		productId: string,
		direction?: 'upgrade' | 'downgrade',
		options?: { skipValidation?: boolean },
	) {
		return withCapture(async () => {
			const tenant =
				await provisioningRepository.findActiveTenantByCustomerEmail(email);
			if (!tenant) throw new Error('No active tenant found for this email');

			const product = await productRepository.findById(productId);
			if (!product.stripePriceId)
				throw new Error('Product not configured for payments');

			const newPlan = await resolvePlanFromProduct(product.id);
			const oldPlan = tenant.current_plan as ProvisioningPlan;

			const resolvedDirection =
				direction ??
				(PLAN_ORDER[newPlan] >= PLAN_ORDER[oldPlan] ? 'upgrade' : 'downgrade');

			if (direction && !options?.skipValidation) {
				if (
					direction === 'upgrade' &&
					PLAN_ORDER[newPlan] <= PLAN_ORDER[oldPlan]
				)
					throw new Error(
						`New plan (${newPlan}) is not higher than current plan (${oldPlan})`,
					);
				if (
					direction === 'downgrade' &&
					PLAN_ORDER[newPlan] >= PLAN_ORDER[oldPlan]
				)
					throw new Error(
						`New plan (${newPlan}) is not lower than current plan (${oldPlan})`,
					);
			}

			const customers = await stripe.customers.list({ email, limit: 1 });
			if (!customers.data.length) throw new Error('No Stripe customer found');
			const customerId = customers.data[0].id;

			const [activeSubs, trialingSubs] = await Promise.all([
				stripe.subscriptions.list({
					customer: customerId,
					status: 'active',
					limit: 1,
				}),
				stripe.subscriptions.list({
					customer: customerId,
					status: 'trialing',
					limit: 1,
				}),
			]);
			const subscription = activeSubs.data[0] ?? trialingSubs.data[0];
			if (!subscription)
				throw new Error('No active or trialing Stripe subscription found');
			const item = subscription.items.data[0];

			const updated = await stripe.subscriptions.update(subscription.id, {
				items: [{ id: item.id, price: product.stripePriceId }],
				proration_behavior:
					resolvedDirection === 'upgrade' ? 'create_prorations' : 'none',
				billing_cycle_anchor: 'unchanged',
			});

			return {
				subscriptionId: updated.id,
				status: updated.status,
				previousPlan: oldPlan,
				newPlan,
			};
		});
	},

	async getSubscriptionDetails(email: string) {
		return withCapture(async () => {
			const customers = await stripe.customers.list({ email, limit: 1 });
			if (customers.data.length === 0) return null;

			const customerId = customers.data[0].id;

			const [active, trialing] = await Promise.all([
				stripe.subscriptions.list({
					customer: customerId,
					status: 'active',
					expand: ['data.items.data.price'],
				}),
				stripe.subscriptions.list({
					customer: customerId,
					status: 'trialing',
					expand: ['data.items.data.price'],
				}),
			]);

			const sub = active.data[0] ?? trialing.data[0];
			if (!sub) return null;

			const item = sub.items.data[0];
			const price = item?.price;

			let productName = 'Unknown';
			if (price?.product && typeof price.product === 'string') {
				const product = await stripe.products.retrieve(price.product);
				productName = product.name;
			}

			const periodEnd = item?.current_period_end;

			return {
				id: sub.id,
				status: sub.status,
				product_name: productName,
				amount: price?.unit_amount ? price.unit_amount / 100 : 0,
				currency: price?.currency ?? 'brl',
				interval: price?.recurring?.interval ?? null,
				currentPeriodEnd: periodEnd
					? new Date(periodEnd * 1000).toISOString()
					: null,
				cancelAtPeriodEnd: sub.cancel_at_period_end,
			};
		});
	},

	async cancelSubscription(email: string) {
		return withCapture(async () => {
			const customers = await stripe.customers.list({ email, limit: 1 });
			if (customers.data.length === 0) return null;

			const customerId = customers.data[0].id;

			const [active, trialing] = await Promise.all([
				stripe.subscriptions.list({
					customer: customerId,
					status: 'active',
					limit: 1,
				}),
				stripe.subscriptions.list({
					customer: customerId,
					status: 'trialing',
					limit: 1,
				}),
			]);

			const sub = active.data[0] ?? trialing.data[0];
			if (!sub) return null;

			const updated = await stripe.subscriptions.update(sub.id, {
				cancel_at_period_end: true,
			});

			const periodEnd = updated.items.data[0]?.current_period_end;

			return {
				message:
					'Subscription will be cancelled at the end of the billing period.',
				cancelAtPeriodEnd: updated.cancel_at_period_end,
				currentPeriodEnd: periodEnd
					? new Date(periodEnd * 1000).toISOString()
					: null,
			};
		});
	},

	async cancelSubscriptionById(data: {
		email: string;
		subscriptionId: string;
	}) {
		return withCapture(async () => {
			const subscription = await stripe.subscriptions.retrieve(
				data.subscriptionId,
				{ expand: ['customer'] },
			);
			if (!subscription) throw new Error('Subscription not found');

			const customer = subscription.customer as Stripe.Customer | null;
			const subscriptionEmail =
				customer && !('deleted' in customer) ? customer.email : null;
			if (subscriptionEmail && subscriptionEmail !== data.email) {
				throw new Error('Subscription does not belong to this customer');
			}

			if (
				subscription.status === 'canceled' ||
				subscription.status === 'incomplete_expired'
			) {
				throw new Error('Subscription is already cancelled');
			}

			const updated = await stripe.subscriptions.update(data.subscriptionId, {
				cancel_at_period_end: true,
			});

			const periodEnd = updated.items.data[0]?.current_period_end;

			return {
				id: updated.id,
				message:
					'Subscription will be cancelled at the end of the billing period.',
				cancelAtPeriodEnd: updated.cancel_at_period_end,
				currentPeriodEnd: periodEnd
					? new Date(periodEnd * 1000).toISOString()
					: null,
			};
		});
	},

	async listAllRecurringSubscriptions(options?: {
		status?: 'active' | 'trialing' | 'all';
		limit?: number;
		starting_after?: string;
	}) {
		return withCapture(async () => {
			const statusFilter = options?.status ?? 'all';
			const limit = options?.limit ?? 100;

			const fetchSubs = async (status: 'active' | 'trialing') =>
				stripe.subscriptions.list({
					status,
					limit,
					...(options?.starting_after && {
						starting_after: options.starting_after,
					}),
					expand: ['data.customer', 'data.items.data.price'],
				});

			const [activeRes, trialingRes] = await Promise.all([
				statusFilter !== 'trialing' ? fetchSubs('active') : null,
				statusFilter !== 'active' ? fetchSubs('trialing') : null,
			]);

			const subscriptions = [
				...(activeRes?.data ?? []),
				...(trialingRes?.data ?? []),
			];

			const productIds = [
				...new Set(
					subscriptions
						.map((sub) => {
							const productRef = sub.items.data[0]?.price?.product;
							return typeof productRef === 'string' ? productRef : null;
						})
						.filter(Boolean) as string[],
				),
			];

			const productMap = Object.fromEntries(
				await Promise.all(
					productIds.map(async (id) => {
						const p = await stripe.products.retrieve(id);
						return [id, p.name] as [string, string];
					}),
				),
			);

			return subscriptions.map((sub) => {
				const customer = sub.customer as Stripe.Customer | null;
				const item = sub.items.data[0];
				const price = item?.price;
				const productRef = price?.product;
				const productName =
					typeof productRef === 'string'
						? (productMap[productRef] ?? 'Unknown Product')
						: 'Unknown Product';

				const periodEnd = item?.current_period_end;

				return {
					id: sub.id,
					status: sub.status,
					customer: {
						name: customer?.name ?? 'Unknown',
						email: customer?.email ?? 'No email',
						phone: customer?.phone ?? null,
					},
					product: productName,
					amount: price?.unit_amount ? price.unit_amount / 100 : 0,
					currency: price?.currency ?? 'brl',
					interval: price?.recurring?.interval ?? null,
					intervalCount: price?.recurring?.interval_count ?? null,
					nextChargeAt: periodEnd
						? new Date(periodEnd * 1000).toISOString()
						: null,
					cancelAtPeriodEnd: sub.cancel_at_period_end,
				};
			});
		});
	},

	async listActiveSubscriptions(email: string) {
		return withCapture(async () => {
			const customers = await stripe.customers.list({ email, limit: 1 });

			if (customers.data.length === 0) {
				return [];
			}

			const customerId = customers.data[0].id;

			const [active, trialing] = await Promise.all([
				stripe.subscriptions.list({ customer: customerId, status: 'active' }),
				stripe.subscriptions.list({
					customer: customerId,
					status: 'trialing',
				}),
			]);

			const subscriptions = [...active.data, ...trialing.data];

			return subscriptions.map((sub) => {
				const item = sub.items.data[0];
				const productRef = item?.price?.product;
				const stripeProductId =
					typeof productRef === 'string'
						? productRef
						: productRef != null &&
								typeof productRef === 'object' &&
								'id' in productRef
							? (productRef as { id: string }).id
							: null;

				const periodEnd = item?.current_period_end;

				return {
					id: sub.id,
					status: sub.status,
					stripeProductId,
					currentPeriodEnd: periodEnd
						? new Date(periodEnd * 1000).toISOString()
						: null,
					cancelAtPeriodEnd: sub.cancel_at_period_end,
				};
			});
		});
	},

	async addAddon(email: string, productId: string) {
		return withCapture(async () => {
			const product = await productRepository.findAddonById(productId);
			const subscription = await findActiveStripeSubscription(email);

			const already = subscription.items.data.find(
				(i) => i.price.id === product.stripePriceId,
			);
			if (already) throw new Error('Addon already attached to subscription');

			const updated = await stripe.subscriptions.update(subscription.id, {
				items: [{ price: product.stripePriceId, quantity: 1 }],
				proration_behavior: 'create_prorations',
				billing_cycle_anchor: 'unchanged',
			});

			const newItem = updated.items.data.find(
				(i) => i.price.id === product.stripePriceId,
			);
			if (!newItem) throw new Error('Failed to attach addon to subscription');

			return {
				subscriptionId: updated.id,
				itemId: newItem.id,
				productId: product.id,
				productName: product.name,
				stripePriceId: product.stripePriceId,
			};
		});
	},

	async removeAddon(email: string, itemId: string) {
		return withCapture(async () => {
			const subscription = await findActiveStripeSubscription(email);
			const item = subscription.items.data.find((i) => i.id === itemId);
			if (!item) throw new Error('Subscription item not found');

			const product = await productRepository.findByStripePriceId(
				item.price.id,
			);
			if (!product.isAddon) throw new Error('Cannot remove the main plan item');

			await stripe.subscriptionItems.del(item.id, {
				proration_behavior: 'create_prorations',
			});
			return { removed: true, itemId };
		});
	},

	async listAddons(email: string) {
		return withCapture(async () => {
			const subscription = await findActiveStripeSubscription(email);
			const items = subscription.items.data;

			const enriched = await Promise.all(
				items.map(async (i) => {
					const p = await productRepository
						.findByStripePriceId(i.price.id)
						.catch(() => null);
					if (!p?.isAddon) return null;
					return {
						itemId: i.id,
						productId: p.id,
						productName: p.name,
						stripePriceId: i.price.id,
						quantity: i.quantity ?? 1,
					};
				}),
			);
			return enriched.filter((x): x is NonNullable<typeof x> => x !== null);
		});
	},
};
