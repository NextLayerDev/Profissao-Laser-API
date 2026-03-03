import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.js';
import { usersController } from '../controllers/user.js';
import { ErrorSchema } from '../types/error.js';
import { userSchema, userUpdateSchema } from '../types/user.js';

export async function userRoute(server: FastifyInstance) {
	server.get(
		'/users',
		{
			preHandler: [authenticate],
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
			preHandler: [authenticate],
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

	server.patch(
		'/user/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Update a user by ID',
				params: z.object({ id: z.uuid() }),
				body: userUpdateSchema,
				response: {
					200: userSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Users'],
			},
		},
		usersController.updateUser,
	);

	server.delete(
		'/user/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Delete a user by ID',
				params: z.object({ id: z.uuid() }),
				response: {
					200: z.object({ message: z.string() }),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Users'],
			},
		},
		usersController.deleteUser,
	);
}
