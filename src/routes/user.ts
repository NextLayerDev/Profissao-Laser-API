import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { usersController } from '@/controllers/user';
import { ErrorSchema } from '@/types/error';
import { userSchema } from '@/types/user';

export async function usersRoutes(server: FastifyInstance) {
	server.get(
		'/users',
		{
			schema: {
				description: 'Get all users',
				response: {
					200: z.array(userSchema),
					500: ErrorSchema,
				},
				tags: ['Users'],
			},
		},
		usersController.getAllUsers,
	);

	server.get(
		'/user/:id',
		{
			schema: {
				description: 'Get a user by ID',
				params: z.object({ id: z.uuid() }),
				response: {
					200: userSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Users'],
			},
		},
		usersController.getUserById,
	);
}
