import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getProductsController } from '../controllers/product.js';
import { authenticate } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import { productSchema } from '../types/product.js';

export async function productRoute(server: FastifyInstance) {
	server.get(
		'/products',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Retrieve a list of all active products with their respective monthly, annual, and lifetime prices at stripe.',
				response: {
					200: z.array(productSchema),
					500: ErrorSchema,
				},
				tags: ['Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		getProductsController,
	);
}
