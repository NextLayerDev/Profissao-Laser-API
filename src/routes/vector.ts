import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createVectorController,
	deleteVectorController,
	getVectorController,
	listVectorsController,
	updateVectorController,
} from '../controllers/vector.js';
import { authenticateVectorizacao } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	createVectorSchema,
	listVectorsQuery,
	updateVectorSchema,
	vectorSchema,
} from '../types/vector.js';

export async function vectorRoute(server: FastifyInstance) {
	server.get(
		'/customer/vectors',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'List vectors for a customer (paginated).',
				querystring: listVectorsQuery,
				response: {
					200: z.object({
						data: z.array(vectorSchema),
						total: z.number(),
					}),
					400: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		listVectorsController,
	);

	server.get(
		'/customer/vectors/:id',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'Get a vector by ID.',
				params: z.object({ id: z.string().uuid() }),
				response: {
					200: vectorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		getVectorController,
	);

	server.post(
		'/customer/vectors',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'Create a new vector (upload SVG).',
				body: createVectorSchema,
				response: {
					201: vectorSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		createVectorController,
	);

	server.patch(
		'/customer/vectors/:id',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'Update a vector.',
				params: z.object({ id: z.string().uuid() }),
				body: updateVectorSchema,
				response: {
					200: vectorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateVectorController,
	);

	server.delete(
		'/customer/vectors/:id',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'Delete a vector.',
				params: z.object({ id: z.string().uuid() }),
				response: {
					204: z.null(),
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteVectorController,
	);
}
