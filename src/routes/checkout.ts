import type { FastifyInstance } from 'fastify';
import { createCheckoutSessionController } from '../controllers/checkout.js';
import { authenticate } from '../middleware/auth.js';
import {
	checkoutBodySchema,
	checkoutResponseSchema,
} from '../types/checkout.js';
import { ErrorSchema } from '../types/error.js';

export async function checkoutRoute(server: FastifyInstance) {
	server.post(
		'/checkout',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Creates a Stripe Checkout Session for a specific price. Returns the URL to redirect the user.',
				body: checkoutBodySchema,
				response: {
					200: checkoutResponseSchema,
					400: ErrorSchema,
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Checkout'],
				security: [{ bearerAuth: [] }],
			},
		},
		createCheckoutSessionController,
	);
}
