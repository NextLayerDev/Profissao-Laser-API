import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	loginController,
	registerController,
} from '@/controllers/auth/customer.controller';
import { ErrorSchema } from '@/types/Schemas/error.schema';

export async function customerAuthRoute(server: FastifyInstance) {
	server.post(
		'/register/customer',
		{
			schema: {
				description: 'Register a new customer.',
				body: z.object({
					name: z.string().min(2),
					email: z.email(),
					password: z.string().min(6),
					role: z.string().optional(),
				}),
				response: {
					201: z.object({ message: z.string() }),
					400: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Auth Customer'],
			},
		},
		registerController,
	);

	server.post(
		'/login/customer',
		{
			schema: {
				description: 'Login as a customer.',
				body: z.object({
					email: z.email(),
					password: z.string().min(6),
				}),
				response: {
					200: z.object({ token: z.string() }),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Auth Customer'],
			},
		},
		loginController,
	);
}
