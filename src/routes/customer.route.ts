import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	loginController,
	registerController,
} from '@/controllers/auth/customer.controller';
import {
	getCustomerController,
	getCustomersController,
	getMeController,
} from '@/controllers/customer.controller';
import { authenticate } from '@/middleware/auth';
import { CustomerSchema } from '@/types/Schemas/customer.schema';
import { ErrorSchema } from '@/types/Schemas/error.schema';

export async function customerRoutes(server: FastifyInstance) {
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

	server.get(
		'/customer/me',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Get current customer profile.',
				response: {
					200: CustomerSchema,
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		getMeController,
	);

	server.get(
		'/customers',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Get all customers.',
				response: {
					200: z.array(CustomerSchema),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		getCustomersController,
	);

	server.get(
		'/customer/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Get customer by ID.',
				params: z.object({
					id: z.uuid(),
				}),
				response: {
					200: CustomerSchema,
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		getCustomerController,
	);
}
