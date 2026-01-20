import type { FastifyInstance } from 'fastify';
import { handleStripeWebhook } from '@/controllers/webhook.controller';

export async function webhookRoute(server: FastifyInstance) {
	// Stripe requires the raw body for signature verification.
	// We need to ensure this route parses the body as a buffer or string, not JSON.
	// In Fastify, this is often done by adding a content type parser specific to this route.
	server.post(
		'/webhook',
		{
			config: {
				rawBody: true, // Requires 'fastify-raw-body' plugin usually
			},
			schema: {
				description: 'Stripe webhook listener',
				tags: ['Webhooks'],
				hide: true, // Hide from Swagger as it's not for users
			},
		},
		handleStripeWebhook,
	);
}
