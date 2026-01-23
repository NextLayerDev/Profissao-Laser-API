import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	getAllPurchasesController,
	getPurchasesController,
} from '../controllers/purchase';
import { authenticate } from '../middleware/auth';
import { ErrorSchema } from '../types/error';

export async function purchaseRoute(server: FastifyInstance) {
	server.get(
		'/purchases',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Retrieve the history of purchases made by the authenticated user.',
				response: {
					200: z.array(
						z.object({
							id: z.string(),
							date: z.string(),
							amount: z.number(),
							currency: z.string().nullable(),
							status: z.string(),
							product: z.string(),
							receipt_url: z.string().nullable(),
						}),
					),
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		getPurchasesController,
	);

	server.get(
		'/purchases/all',
		{
			// preHandler: [authenticate],
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
