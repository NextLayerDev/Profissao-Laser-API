import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireModule } from '@/middleware/auth.js';
import { roleController } from '../controllers/role.js';
import { ErrorSchema } from '../types/error.js';
import {
	effectivePermissionsSchema,
	permissionModuleSchema,
	roleCreateSchema,
	roleSchema,
	roleUpdateSchema,
} from '../types/role.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

export async function roleRoute(server: FastifyInstance) {
	server.get(
		'/me/permissions',
		{
			preHandler: [requireModule('acessos')],
			schema: {
				description: 'Effective permissions for the current staff user.',
				response: { 200: effectivePermissionsSchema, 500: ErrorSchema },
				tags: ['Roles'],
				security: [{ bearerAuth: [] }],
			},
		},
		roleController.myPermissions,
	);

	server.get(
		'/permissions/catalog',
		{
			preHandler: [requireModule('acessos')],
			schema: {
				description: 'List of permission modules and actions (catalog).',
				response: { 200: z.array(permissionModuleSchema), 500: ErrorSchema },
				tags: ['Roles'],
				security: [{ bearerAuth: [] }],
			},
		},
		roleController.catalog,
	);

	server.get(
		'/roles',
		{
			preHandler: [requireModule('acessos')],
			schema: {
				description: 'List all roles with their grants.',
				response: { 200: z.array(roleSchema), 500: ErrorSchema },
				tags: ['Roles'],
				security: [{ bearerAuth: [] }],
			},
		},
		roleController.list,
	);

	server.get(
		'/role/:id',
		{
			preHandler: [requireModule('acessos')],
			schema: {
				description: 'Get a role by ID.',
				params: idParam,
				response: { 200: roleSchema, 404: ErrorSchema, 500: ErrorSchema },
				tags: ['Roles'],
				security: [{ bearerAuth: [] }],
			},
		},
		roleController.getById,
	);

	server.post(
		'/roles',
		{
			preHandler: [requireModule('acessos')],
			schema: {
				description: 'Create a role.',
				body: roleCreateSchema,
				response: { 201: roleSchema, 400: ErrorSchema },
				tags: ['Roles'],
				security: [{ bearerAuth: [] }],
			},
		},
		roleController.create,
	);

	server.patch(
		'/role/:id',
		{
			preHandler: [requireModule('acessos')],
			schema: {
				description: 'Update a role.',
				params: idParam,
				body: roleUpdateSchema,
				response: { 200: roleSchema, 400: ErrorSchema },
				tags: ['Roles'],
				security: [{ bearerAuth: [] }],
			},
		},
		roleController.update,
	);

	server.delete(
		'/role/:id',
		{
			preHandler: [requireModule('acessos')],
			schema: {
				description:
					'Delete a role (blocked if users reference it or it is super-admin).',
				params: idParam,
				response: {
					200: z.object({ message: z.string() }),
					400: ErrorSchema,
				},
				tags: ['Roles'],
				security: [{ bearerAuth: [] }],
			},
		},
		roleController.remove,
	);
}
