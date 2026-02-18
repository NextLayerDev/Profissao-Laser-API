import type Stripe from 'stripe';
import { stripe } from '../lib/stripe.js';

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
			expand: ['data.line_items', 'data.customer'],
			limit: 100,
		});

		return sessions.data.map((session) => {
			const item = session.line_items?.data[0];
			// biome-ignore lint/suspicious/noExplicitAny: Stripe.Customer can be an object or string, so we cast it to any.
			const customer = session.customer as any;

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
				},
				receipt_url: session.url,
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
			trial_end: Math.floor(new Date(data.endsAt).getTime() / 1000),
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
