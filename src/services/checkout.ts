import { stripe } from '../lib/stripe.js';

export class CheckoutService {
	async createCheckoutSession(
		priceId: string,
		userEmail: string,
		userId: string,
		successUrl: string,
		cancelUrl: string,
	) {
		// 1. Retrieve the price to determine if it's a subscription or a one-time payment
		const price = await stripe.prices.retrieve(priceId);

		if (!price) {
			throw new Error('Price not found');
		}

		// 2. Create the checkout session
		const session = await stripe.checkout.sessions.create({
			mode: price.type === 'recurring' ? 'subscription' : 'payment',
			payment_method_types: ['card'],
			client_reference_id: userId, // Track which user is buying
			line_items: [
				{
					price: priceId,
					quantity: 1,
				},
			],
			customer_email: userEmail,
			success_url: successUrl,
			cancel_url: cancelUrl,
			allow_promotion_codes: true,
			metadata: {
				userId, // Backup in metadata
			},
		});

		return { url: session.url, sessionId: session.id };
	}
}

export const checkoutService = new CheckoutService();
