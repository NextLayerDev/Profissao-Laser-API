import type Stripe from 'stripe';
import { withCapture } from '@/lib/sentry.js';
import { stripe } from '../lib/stripe.js';
import { customerRepository } from '../repositories/customer.js';
import { productRepository } from '../repositories/product.js';
import { provisioningRepository } from '../repositories/provisioning.js';
import type { ProvisioningPlan } from '../types/provisioning.js';
import { PLAN_ORDER, resolvePlanFromProduct } from '../utils/plan.js';

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
			const sessions = await stripe.checkout.sessions.list({
				status: 'complete',
				expand: [
					'data.line_items',
					'data.customer',
					'data.payment_intent.latest_charge',
					'data.subscription.latest_invoice',
				],
				limit: 100,
			});

			const emails = sessions.data
				.map((s) => {
					// biome-ignore lint/suspicious/noExplicitAny: Stripe types require any for expanded nested objects.
					const c = s.customer as any;
					return c?.email || s.customer_details?.email;
				})
				.filter(Boolean) as string[];

			const [dbPhones, dbNames] = await Promise.all([
				customerRepository.findPhonesByEmails(emails),
				provisioningRepository.findNamesByEmails(emails),
			]);

			return sessions.data.map((session) => {
				const item = session.line_items?.data[0];
				// biome-ignore lint/suspicious/noExplicitAny: Stripe types require any for expanded nested objects.
				const customer = session.customer as any;
				// biome-ignore lint/suspicious/noExplicitAny: payment_intent is expanded with latest_charge.
				const paymentIntent = session.payment_intent as any;
				// biome-ignore lint/suspicious/noExplicitAny: subscription is expanded with latest_invoice.
				const subscription = session.subscription as any;
				const receiptUrl =
					paymentIntent?.latest_charge?.receipt_url ??
					subscription?.latest_invoice?.hosted_invoice_url ??
					null;
				const email = customer?.email || session.customer_details?.email || '';

				return {
					id: session.id,
					date: new Date(session.created * 1000).toISOString(),
					amount: session.amount_total ? session.amount_total / 100 : 0,
					currency: session.currency,
					status: session.payment_status,
					product: item?.description || 'Unknown Product',
					customer: {
						name:
							customer?.name ||
							session.customer_details?.name ||
							dbNames[email] ||
							'Unknown',
						email: email || 'No email',
						phone:
							customer?.phone ||
							session.customer_details?.phone ||
							dbPhones[email] ||
							null,
					},
					receipt_url: receiptUrl,
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

			const session = await stripe.checkout.sessions.create({
				customer: customer.id,
				line_items: [{ price: product.stripePriceId, quantity: 1 }],
				mode,
				payment_method_types: ['card', 'boleto'],
				success_url: `${process.env.SUCCESS_URL ?? 'http://localhost:3000/checkout/success'}?session_id={CHECKOUT_SESSION_ID}`,
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

			if (direction) {
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
};
