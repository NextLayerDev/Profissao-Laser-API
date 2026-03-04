import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { stripe } from '../lib/stripe.js';
import { customerRepository } from '../repositories/customer.js';
import { productRepository } from '../repositories/product.js';
import { subscriptionRepository } from '../repositories/subscription.js';

export async function webhookRoute(server: FastifyInstance) {
	server.addContentTypeParser(
		'application/json',
		{ parseAs: 'buffer' },
		(_req, body, done) => {
			done(null, body);
		},
	);

	server.post('/webhook/stripe', async (request, reply) => {
		const sig = request.headers['stripe-signature'] as string;
		const secret = process.env.STRIPE_WEBHOOK_SECRET!;

		let event: Stripe.Event;
		try {
			event = stripe.webhooks.constructEvent(
				request.body as Buffer,
				sig,
				secret,
			);
		} catch {
			return reply.status(400).send({ message: 'Invalid webhook signature' });
		}

		if (event.type === 'checkout.session.completed') {
			await handleCheckoutCompleted(
				event.data.object as Stripe.Checkout.Session,
			);
		}

		return reply.status(200).send({ received: true });
	});
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
	if (session.mode !== 'subscription') return;

	const email = session.customer_details?.email;
	if (!email) return;

	const { data: customer } = await customerRepository.getCustomerPlan(email);
	if (!customer) return;

	const subscription = await stripe.subscriptions.retrieve(
		session.subscription as string,
	);
	const item = subscription.items.data[0];
	const priceId = item?.price.id;
	if (!priceId) return;

	const product = await productRepository.findByStripePriceId(priceId);

	await subscriptionRepository.upsertByStripeSubscriptionId({
		userId: customer.id,
		productId: product.id,
		status: 'active',
		stripeSubscriptionId: subscription.id,
		stripeCustomerId: session.customer as string,
		stripePriceId: priceId,
		currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString(),
		cancelAtPeriodEnd: subscription.cancel_at_period_end,
	});
}
