import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	loginController,
	registerController,
} from '@/controllers/auth/user.controller';
import {
	getMeController,
	getUserController,
	getUsersController,
} from '@/controllers/user.controller';
import { authenticate } from '@/middleware/auth';
import { ErrorSchema } from '@/types/Schemas/error.schema';
import { UserSchema } from '@/types/Schemas/user.schema';

export async function userRoutes(server: FastifyInstance) {
	server.post(
		'/register/user',
		{
			schema: {
				description: 'Register a new administrative user.',
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
				tags: ['Auth User'],
			},
		},
		registerController,
	);

	server.post(
		'/login/user',
		{
			schema: {
				description: 'Login as an administrative user.',
				body: z.object({
					email: z.email(),
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
		loginController,
	);

	server.get(
		'/users/me',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Get current user profile.',
				response: {
					200: UserSchema,
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['User'],
			},
		},
		getMeController,
	);

	server.get(
		'/users',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Get all users.',
				response: {
					200: z.array(UserSchema),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['User'],
			},
		},
		getUsersController,
	);

	server.get(
		'/user/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Get user by ID.',
				params: z.object({
					id: z.uuid(),
				}),
				response: {
					200: UserSchema,
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['User'],
			},
		},
		getUserController,
	);
}
