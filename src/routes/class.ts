import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.js';
import {
	addProductToClassController,
	createClassController,
	deleteClassController,
	getClassByIdController,
	getClassesController,
	removeProductFromClassController,
	updateClassController,
} from '../controllers/class.js';
import {
	addProductToClassSchema,
	classSchema,
	classWithProductsSchema,
	createClassSchema,
	updateClassSchema,
} from '../types/class.js';
import { ErrorSchema } from '../types/error.js';

export async function classRoute(server: FastifyInstance) {
	server.get(
		'/classes',
		{
			preHandler: [authenticate],
			schema: {
				description: 'List all classes with their included products.',
				response: {
					200: z.array(classWithProductsSchema),
					500: ErrorSchema,
				},
				tags: ['Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		getClassesController,
	);

	server.get(
		'/class/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Get a class by ID with its included products.',
				params: z.object({ id: z.string().uuid() }),
				response: {
					200: classWithProductsSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		getClassByIdController,
	);

	server.post(
		'/class',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Create a new class.',
				body: createClassSchema,
				response: {
					201: classSchema,
					500: ErrorSchema,
				},
				tags: ['Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		createClassController,
	);

	server.patch(
		'/class/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Update a class (name, tier, description, status).',
				params: z.object({ id: z.string().uuid() }),
				body: updateClassSchema,
				response: {
					200: classSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateClassController,
	);

	server.delete(
		'/class/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Delete a class.',
				params: z.object({ id: z.string().uuid() }),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteClassController,
	);

	server.post(
		'/class/:id/product',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Add a product to a class.',
				params: z.object({ id: z.string().uuid() }),
				body: addProductToClassSchema,
				response: {
					201: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		addProductToClassController,
	);

	server.delete(
		'/class/:id/product/:productId',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Remove a product from a class.',
				params: z.object({
					id: z.string().uuid(),
					productId: z.string(),
				}),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Classes'],
				security: [{ bearerAuth: [] }],
			},
		},
		removeProductFromClassController,
	);
}
