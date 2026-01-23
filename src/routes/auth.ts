import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authController } from '../controllers/auth.js';
import { registerCustomerSchema, registerUserSchema } from '../types/auth.js';
import { ErrorSchema } from '../types/error.js';

export async function authRoutes(server: FastifyInstance) {
	server.post(
		'/register/customer',
		{
			schema: {
				description: 'Register a new customer.',
				body: registerCustomerSchema,
				response: {
					201: z.object({ message: z.string() }),
					400: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Auth Customer'],
			},
		},
		authController.registerCustomer,
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
		authController.loginCustomer,
	);

	server.post(
		'/register/user',
		{
			schema: {
				description: 'Register a new user',
				body: registerUserSchema,
				response: {
					201: z.object({ message: z.string() }),
					400: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Auth User'],
			},
		},
		authController.registerUser,
	);

	server.post(
		'/login/user',
		{
			schema: {
				description: 'Login as a user',
				body: z.object({
					email: z.string().email(),
					password: z.string().min(6),
				}),
				response: {
					200: z.object({ token: z.string() }),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Auth User'],
			},
		},
		authController.loginUser,
	);
}
