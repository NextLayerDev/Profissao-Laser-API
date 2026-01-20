import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getProductsController } from '@/controllers/product.controller';
import { authenticate } from '@/middleware/auth';
import { ErrorSchema } from '@/types/Schemas/error.schema';

export async function productRoute(server: FastifyInstance) {
	server.get(
		'/products',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Retrieve a list of all active products with their respective monthly, annual, and lifetime prices at stripe.',
				response: {
					200: z.array(
						z.object({
							id: z.string(),
							name: z.string(),
							description: z.string().nullable(),
							image: z.string().nullable(),
							prices: z.object({
								monthly: z.number().nullable(),
								annual: z.number().nullable(),
								lifetime: z.number().nullable(),
							}),
							currency: z.string(),
						}),
					),
					500: ErrorSchema,
				},
				tags: ['Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		getProductsController,
	);
}
