import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.js';
import { authController } from '../controllers/auth.js';
import {
	registerCustomerSchema,
	registerUserSchema,
} from '../services/types/auth.js';
import { ErrorSchema } from '../services/types/error.js';

export async function authRoute(server: FastifyInstance) {
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
			preHandler: [authenticate],
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

	server.post(
		'/forgot-password',
		{
			schema: {
				description: 'Send password recovery email',
				body: z.object({ email: z.email() }),
				response: {
					200: z.object({ message: z.string() }),
					400: ErrorSchema,
				},
				tags: ['Auth Customer'],
			},
		},
		authController.forgotPassword,
	);

	server.post(
		'/reset-password',
		{
			schema: {
				description: 'Resetar senha com token recebido por email.',
				body: z.object({
					token: z.string().uuid(),
					newPassword: z.string().min(6),
				}),
				response: {
					200: z.object({ message: z.string() }),
					400: ErrorSchema,
				},
				tags: ['Auth Customer'],
			},
		},
		authController.resetPassword,
	);
}
