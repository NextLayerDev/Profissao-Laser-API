import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	getAllPurchasesController,
	getPurchasesController,
} from '../../controllers/purchase.js';
import { ErrorSchema } from '../../types/error.js';

export default async function (server: FastifyInstance) {
	server.get(
		'/',
		{
			// preHandler: [authenticate],
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
		'/all',
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
