import type { FastifyReply, FastifyRequest } from 'fastify';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { updateCustomer } from '@/repositories/customer.repository';

export const handleStripeWebhook = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const sig = request.headers['stripe-signature'];
	const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

	if (!sig || !webhookSecret) {
		return reply
			.status(400)
			.send({ message: 'Missing Stripe signature or secret' });
	}

	let event: Stripe.Event;

	try {
		// Verify signature using the raw body
		const rawBody = request.rawBody || JSON.stringify(request.body);

		event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		request.log.error(`Webhook signature verification failed: ${message}`);
		return reply.status(400).send({ message: `Webhook Error: ${message}` });
	}

	if (event.type === 'checkout.session.completed') {
		const session = event.data.object;
		const userId = session.client_reference_id || session.metadata?.userId;

		if (userId) {
			const stripeOperationId =
				(session.subscription as string) ||
				(session.payment_intent as string) ||
				session.id;

			let accessLevel = 'premium';

			try {
				const fullSession = await stripe.checkout.sessions.retrieve(
					session.id,
					{
						expand: ['line_items'],
					},
				);
				const productName = fullSession.line_items?.data[0]?.description;
				if (productName) accessLevel = productName;
			} catch (_e) {
				request.log.error('Failed to fetch line items for session');
			}

			await updateCustomer(userId, {
				stripe: stripeOperationId,
				access: accessLevel,
			});
			request.log.info(
				`Customer ${userId} updated with stripe id ${stripeOperationId}`,
			);
		}
	}

	return reply.send({ received: true });
};
