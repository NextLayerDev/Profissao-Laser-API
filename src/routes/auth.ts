import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.js';
import { authController } from '../controllers/auth.js';
import { registerCustomerSchema, registerUserSchema } from '../types/auth.js';
import { ErrorSchema } from '../types/error.js';

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
				description:
					'Login as a customer. Returns access_token, refresh_token and customer profile so the client can hydrate UI without an extra round-trip.',
				body: z.object({
					email: z.email(),
					password: z.string().min(6),
				}),
				response: {
					200: z.object({
						token: z.string(),
						refresh_token: z.string(),
						expires_at: z.number().nullable(),
						customer: z.object({
							id: z.string(),
							email: z.string(),
							name: z.string(),
							phone: z.string().nullable(),
						}),
					}),
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
				description:
					'Login as a user (staff/admin). Returns access_token, refresh_token and user profile so the client can hydrate UI without an extra round-trip.',
				body: z.object({
					email: z.string().email(),
					password: z.string().min(6),
				}),
				response: {
					200: z.object({
						token: z.string(),
						refresh_token: z.string(),
						expires_at: z.number().nullable(),
						user: z.object({
							id: z.string(),
							email: z.string(),
							name: z.string(),
							role: z.string(),
						}),
					}),
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
		'/auth/refresh',
		{
			schema: {
				description:
					'Exchange a refresh_token for a new access_token. Used by clients (e.g. system_porteira course-only deploy) to keep sessions alive without re-prompting the user.',
				body: z.object({ refresh_token: z.string().min(10) }),
				response: {
					200: z.object({
						token: z.string(),
						refresh_token: z.string(),
						expires_at: z.number().nullable(),
					}),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Auth'],
			},
		},
		authController.refresh,
	);

	server.get(
		'/auth/me',
		{
			schema: {
				description:
					'Resolve the current identity from the Bearer token. Returns either { type: "user", ... } or { type: "customer", ... }. Used by external frontends (e.g. system_porteira course-only) to hydrate session on SSR without sharing JWT secrets.',
				security: [{ bearerAuth: [] }],
				response: {
					200: z.union([
						z.object({
							type: z.literal('user'),
							id: z.string(),
							email: z.string(),
							name: z.string(),
							role: z.string(),
						}),
						z.object({
							type: z.literal('customer'),
							id: z.string(),
							email: z.string(),
							name: z.string(),
							phone: z.string().nullable(),
						}),
					]),
					401: ErrorSchema,
				},
				tags: ['Auth'],
			},
		},
		authController.me,
	);
}
