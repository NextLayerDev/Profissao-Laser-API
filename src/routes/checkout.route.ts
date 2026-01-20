import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createCheckoutSessionController } from '@/controllers/checkout.controller';
import { authenticate } from '@/middleware/auth';
import { createCheckoutBodySchema } from '@/types/Schemas/checkout.schema';
import { ErrorSchema } from '@/types/Schemas/error.schema';

export async function checkoutRoute(server: FastifyInstance) {
	server.post(
		'/checkout',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Creates a Stripe Checkout Session for a specific price. Returns the URL to redirect the user.',
				body: createCheckoutBodySchema,
				response: {
					200: z.object({
						url: z.string().nullable(),
						sessionId: z.string(),
					}),
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
