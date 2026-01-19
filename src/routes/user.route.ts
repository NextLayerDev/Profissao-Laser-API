import type { FastifyInstance } from 'fastify';
import {
	getUsersController,
	updateUserController,
} from '@/controllers/user.controller';
import { UpdateUserSchema, UserSchema } from '@/types/Schemas/user.schema';

export async function userRoute(server: FastifyInstance) {
	server.get(
		'/users',
		{
			schema: UserSchema,
		},
		getUsersController,
	);

	server.put(
		'/users/:id',
		{
			schema: UpdateUserSchema,
		},
		updateUserController,
	);
}
