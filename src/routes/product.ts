import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.js';
import {
	createProductController,
	deleteProductController,
	getProductsController,
	updateProductController,
	updateProductStatusController,
	uploadProductImageController,
} from '../controllers/product.js';
import { ErrorSchema } from '../types/error.js';
import {
	createdProductResponseSchema,
	createProductSchema,
	productSchema,
	updateProductSchema,
	updateProductStatusSchema,
} from '../types/product.js';

export async function productRoute(server: FastifyInstance) {
	server.get(
		'/products',
		{
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

	server.post(
		'/product',
		{
			preHandler: [authenticate],
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

	server.patch(
		'/product/:id',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Update a product (name, description, category, price, refundDays). Name and price are synced with Stripe.',
				params: z.object({ id: z.string() }),
				body: updateProductSchema,
				response: {
					200: productSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateProductController,
	);

	server.patch(
		'/product/:id/status',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Activate or deactivate a product (also syncs with Stripe).',
				params: z.object({ id: z.string() }),
				body: updateProductStatusSchema,
				response: {
					200: productSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateProductStatusController,
	);

	server.post(
		'/product/:id/image',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Upload a cover image for a product. Send as multipart/form-data with a single field: file.',
				params: z.object({ id: z.string() }),
				consumes: ['multipart/form-data'],
				response: {
					200: productSchema,
					400: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadProductImageController,
	);

	server.delete(
		'/product/:id',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Archive a product in Stripe (deactivates all prices) and delete it from the database.',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Products'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteProductController,
	);
}
