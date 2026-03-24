import type Stripe from 'stripe';
import { PLAN_ORDER, resolvePlanFromProduct } from '../lib/plan.js';
import { stripe } from '../lib/stripe.js';
import { productRepository } from '../repositories/product.js';
import { provisioningRepository } from '../repositories/provisioning.js';
import type { ProvisioningPlan } from '../types/provisioning.js';

export class PurchaseService {
	async listPurchases(email: string) {
		const customers = await stripe.customers.list({
			email: email,
			limit: 1,
		});

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
	}

	async listAllPurchases() {
		const sessions = await stripe.checkout.sessions.list({
			status: 'complete',
			expand: [
				'data.line_items',
				'data.customer',
				'data.payment_intent.latest_charge',
			],
			limit: 100,
		});

		return sessions.data.map((session) => {
			const item = session.line_items?.data[0];
			// biome-ignore lint/suspicious/noExplicitAny: Stripe types require any for expanded nested objects.
			const customer = session.customer as any;
			// biome-ignore lint/suspicious/noExplicitAny: payment_intent is expanded with latest_charge.
			const paymentIntent = session.payment_intent as any;
			const receiptUrl = paymentIntent?.latest_charge?.receipt_url ?? null;

			return {
				id: session.id,
				date: new Date(session.created * 1000).toISOString(),
				amount: session.amount_total ? session.amount_total / 100 : 0,
				currency: session.currency,
				status: session.payment_status,
				product: item?.description || 'Unknown Product',
				customer: {
					name: customer?.name || 'Unknown',
					email:
						customer?.email || session.customer_details?.email || 'No email',
					phone: customer?.phone || session.customer_details?.phone || null,
				},
				receipt_url: receiptUrl,
			};
		});
	}

	async listPaymentAttempts(options?: {
		status?: 'succeeded' | 'failed' | 'all';
		limit?: number;
		starting_after?: string;
	}) {
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

			return {
				id: intent.id,
				date: new Date(intent.created * 1000).toISOString(),
				amount: intent.amount / 100,
				currency: intent.currency,
				status: resolvedStatus,
				failure_message: intent.last_payment_error?.message ?? null,
				product: intent.description ?? charge?.description ?? 'Unknown Product',
				customer: {
					name: customer?.name ?? charge?.billing_details?.name ?? 'Unknown',
					email:
						customer?.email ?? charge?.billing_details?.email ?? 'No email',
					phone: customer?.phone ?? charge?.billing_details?.phone ?? null,
				},
				receipt_url: charge?.receipt_url ?? null,
			};
		});
	}

	async createSubscription(data: {
		email: string;
		stripeProductId: string;
		amount: number;
		interval: 'month' | 'year';
		intervalCount: number;
		endsAt: string;
	}) {
		const existing = await stripe.customers.list({
			email: data.email,
			limit: 1,
		});

		const customer =
			existing.data.length > 0
				? existing.data[0]
				: await stripe.customers.create({ email: data.email });

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
	}

	async createPurchase(data: {
		email: string;
		productId: string;
		companyName?: string;
		phone?: string;
	}) {
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
	}

	async changePlan(
		email: string,
		productId: string,
		direction: 'upgrade' | 'downgrade',
	) {
		const tenant =
			await provisioningRepository.findActiveTenantByCustomerEmail(email);
		if (!tenant) throw new Error('No active tenant found for this email');

		const product = await productRepository.findById(productId);
		if (!product.stripePriceId)
			throw new Error('Product not configured for payments');

		const newPlan = await resolvePlanFromProduct(product.id);
		const oldPlan = tenant.current_plan as ProvisioningPlan;

		if (direction === 'upgrade' && PLAN_ORDER[newPlan] <= PLAN_ORDER[oldPlan])
			throw new Error(
				`New plan (${newPlan}) is not higher than current plan (${oldPlan})`,
			);
		if (direction === 'downgrade' && PLAN_ORDER[newPlan] >= PLAN_ORDER[oldPlan])
			throw new Error(
				`New plan (${newPlan}) is not lower than current plan (${oldPlan})`,
			);

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
				direction === 'upgrade' ? 'create_prorations' : 'none',
		});

		return {
			subscriptionId: updated.id,
			status: updated.status,
			previousPlan: oldPlan,
			newPlan,
		};
	}

	async listActiveSubscriptions(email: string) {
		const customers = await stripe.customers.list({
			email: email,
			limit: 1,
		});

		if (customers.data.length === 0) {
			return [];
		}

		const customerId = customers.data[0].id;

		const [active, trialing] = await Promise.all([
			stripe.subscriptions.list({ customer: customerId, status: 'active' }),
			stripe.subscriptions.list({ customer: customerId, status: 'trialing' }),
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

			return {
				id: sub.id,
				status: sub.status,
				stripeProductId,
			};
		});
	}
}

export const purchaseService = new PurchaseService();
