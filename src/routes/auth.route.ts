import type { FastifyInstance } from 'fastify';
import {
	loginController,
	registerController,
} from '@/controllers/auth.controller';
import { LoginSchema, RegisterSchema } from '@/types/Schemas/auth.schema';

export async function authRoute(server: FastifyInstance) {
	server.post(
		'/register',
		{
			schema: RegisterSchema,
		},
		registerController,
	);

	server.post(
		'/login',
		{
			schema: LoginSchema,
		},
		loginController,
	);
}
