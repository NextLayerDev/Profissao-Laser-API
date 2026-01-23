import { stripe } from '../lib/stripe.js';

export class PurchaseService {
	async listPurchases(email: string) {
		// 1. Find the Stripe Customer ID by email
		const customers = await stripe.customers.list({
			email: email,
			limit: 1,
		});

		if (customers.data.length === 0) {
			return [];
		}

		const customerId = customers.data[0].id;

		// 2. List successful checkout sessions for this customer
		const sessions = await stripe.checkout.sessions.list({
			customer: customerId,
			status: 'complete',
			expand: ['data.line_items'],
		});

		// 3. Map to a friendly format
		return sessions.data.map((session) => {
			const item = session.line_items?.data[0];
			return {
				id: session.id,
				date: new Date(session.created * 1000).toISOString(),
				amount: session.amount_total ? session.amount_total / 100 : 0,
				currency: session.currency,
				status: session.payment_status,
				product: item?.description || 'Unknown Product',
				receipt_url: session.url, // Or invoice_url if available
			};
		});
	}

	async listAllPurchases() {
		// List all successful checkout sessions
		const sessions = await stripe.checkout.sessions.list({
			status: 'complete',
			expand: ['data.line_items', 'data.customer'],
			limit: 100,
		});

		return sessions.data.map((session) => {
			const item = session.line_items?.data[0];
			// biome-ignore lint/suspicious/noExplicitAny: Stripe.Customer can be an object or string, so we cast it to any.
			const customer = session.customer as any; // Cast as Stripe.Customer or similar

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
}

export const purchaseService = new PurchaseService();
