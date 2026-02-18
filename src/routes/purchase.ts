import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.js';
import {
	createPurchaseController,
	createSubscriptionController,
	getAllPurchasesController,
} from '../controllers/purchase.js';
import { ErrorSchema } from '../types/error.js';

export async function purchaseRoute(server: FastifyInstance) {
	server.post(
		'/purchase',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Create a Stripe checkout session for a product purchase.',
				body: z.object({
					productId: z.uuid(),
					amount: z.number().positive(),
					recorrencia: z.enum(['one_time', 'month', 'year']),
				}),
				response: {
					201: z.object({
						id: z.string(),
						checkoutUrl: z.string().nullable(),
						status: z.string().nullable(),
						amount: z.number(),
						recorrencia: z.string(),
						productName: z.string(),
					}),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		createPurchaseController,
	);

	server.post(
		'/subscription',
		{
			// preHandler: [authenticate],
			schema: {
				description: 'Create a Stripe subscription for a user by email.',
				body: z.object({
					email: z.email(),
					stripeProductId: z.string(),
					amount: z.number().nonnegative(),
					interval: z.enum(['month', 'year']),
					intervalCount: z.number().int().positive().default(1),
					endsAt: z.string(),
				}),
				response: {
					201: z.object({
						id: z.string(),
						status: z.string(),
						customerId: z.string(),
						email: z.string(),
						amount: z.number(),
						interval: z.string(),
						intervalCount: z.number(),
						endsAt: z.string(),
					}),
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		createSubscriptionController,
	);

	server.get(
		'/sales',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Retrieve all purchases (Administrative view).',
				response: {
					200: z.array(
						z.object({
							id: z.string(),
							date: z.string(),
							amount: z.number(),
							currency: z.string().nullable(),
							status: z.string(),
							product: z.string(),
							customer: z.object({
								name: z.string(),
								email: z.string(),
							}),
							receipt_url: z.string().nullable(),
						}),
					),
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		getAllPurchasesController,
	);
}
