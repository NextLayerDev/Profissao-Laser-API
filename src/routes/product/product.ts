import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createProductController,
	getProductsCatalogController,
	getProductsController,
} from '../../controllers/product.js';
import { ErrorSchema } from '../../types/error.js';
import {
	catalogProductsResponseSchema,
	createdProductResponseSchema,
	createProductSchema,
	productSchema,
} from '../../types/product.js';

export default async function (server: FastifyInstance) {
	server.get(
		'/',
		{
			// preHandler: [authenticate],
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

	server.get(
		'/catalog',
		{
			// preHandler: [authenticate],
			schema: {
				description: 'Retrieve all products from the Catalog table.',
				response: {
					200: catalogProductsResponseSchema,
					500: ErrorSchema,
				},
				tags: ['Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		getProductsCatalogController,
	);

	server.post(
		'/',
		{
			// preHandler: [authenticate],
			schema: {
				description:
					'Create a new product in Stripe and save its IDs in the database.',
				body: createProductSchema,
				response: {
					201: createdProductResponseSchema,
					500: ErrorSchema,
				},
				tags: ['Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		createProductController,
	);
}
