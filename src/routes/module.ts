import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, authenticateAdmin } from '@/middleware/auth.js';
import {
	createModuleController,
	deleteModuleController,
	listModulesController,
	reorderModulesController,
	updateModuleController,
} from '../controllers/module.js';
import { ErrorSchema } from '../types/error.js';
import {
	createModuleSchema,
	moduleSchema,
	reorderModulesSchema,
	updateModuleSchema,
} from '../types/module.js';

export async function moduleRoute(server: FastifyInstance) {
	server.get(
		'/module/:productId',
		{
			preHandler: [authenticate],
			schema: {
				description: 'List all modules of a product ordered by position.',
				params: z.object({ productId: z.string() }),
				response: {
					200: z.array(moduleSchema),
					500: ErrorSchema,
				},
				tags: ['Modules'],
				security: [{ bearerAuth: [] }],
			},
		},
		listModulesController,
	);

	server.post(
		'/module',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Create a new module for a product.',
				body: createModuleSchema,
				response: {
					201: moduleSchema,
					500: ErrorSchema,
				},
				tags: ['Modules'],
				security: [{ bearerAuth: [] }],
			},
		},
		createModuleController,
	);

	server.put(
		'/module/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Update a module.',
				params: z.object({ id: z.string() }),
				body: updateModuleSchema,
				response: {
					200: moduleSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Modules'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateModuleController,
	);

	server.patch(
		'/module/reorder',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Reorder modules by position in the given array.',
				body: reorderModulesSchema,
				response: {
					204: z.null(),
					500: ErrorSchema,
				},
				tags: ['Modules'],
				security: [{ bearerAuth: [] }],
			},
		},
		reorderModulesController,
	);

	server.delete(
		'/module/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Delete a module and all its lessons.',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Modules'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteModuleController,
	);
}
