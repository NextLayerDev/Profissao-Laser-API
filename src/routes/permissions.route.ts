import type { FastifyInstance } from 'fastify';
import { getPermissionsController } from '@/controllers/permissions.controller';
import { PermissionsSchema } from '@/types/Schemas/permissions.schema';

export async function permissionsRoute(server: FastifyInstance) {
	server.get(
		'/permissions',
		{
			schema: PermissionsSchema,
		},
		getPermissionsController,
	);
}
