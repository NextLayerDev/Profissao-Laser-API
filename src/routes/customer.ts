import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { customerController } from '../controllers/customer.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { customerSchema } from '../types/customer.js';
import { ErrorSchema } from '../types/error.js';

export async function customerRoute(server: FastifyInstance) {
	server.get(
		'/customers',
		{
			// preHandler: [authenticate],
			schema: {
				description: 'Get all customers.',
				response: {
					200: z.array(
						customerSchema
							.omit({ password: true })
							.extend({
								stripe: z.string().nullable(),
								access: z.string().nullable(),
								banned: z.boolean(),
							}),
					),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.getAllCustomers,
	);

	server.get(
		'/customer/:id',
		{
			schema: {
				description: 'Get a customer by ID',
				params: z.object({ id: z.string() }),
				response: {
					200: customerSchema
						.omit({ password: true })
						.extend({
							stripe: z.string().nullable(),
							access: z.string().nullable(),
							banned: z.boolean(),
						}),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.getCustomerById,
	);

	server.delete(
		'/customer',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Delete a customer by ID',
				body: z.object({ id: z.string() }),
				response: {
					200: z.object({ message: z.string() }),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.deleteCustomer,
	);

	server.patch(
		'/customer/:id/block',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Block or unblock a customer',
				params: z.object({ id: z.string() }),
				body: z.object({ blocked: z.boolean() }),
				response: {
					200: z.object({ message: z.string() }),
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.blockCustomer,
	);

	server.patch(
		'/customer/:id/password',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Change the password of a customer',
				params: z.object({ id: z.string() }),
				body: z.object({ password: z.string().min(6) }),
				response: {
					200: z.object({ message: z.string() }),
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.changePassword,
	);

	server.get(
		'/customer/plans/:email',
		{
			schema: {
				description: 'Get the user plans',
				params: z.object({ email: z.email() }),
				response: {
					200: z.any(),
					404: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.getCustomerPlans,
	);
}
