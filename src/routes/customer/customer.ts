import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { customerController } from '../../controllers/customer.js';
import { customerSchema } from '../../types/customer.js';
import { ErrorSchema } from '../../types/error.js';

export default async function (server: FastifyInstance) {
	server.get(
		'/',
		{
			// preHandler: [authenticate],
			schema: {
				description: 'Get all customers.',
				response: {
					200: z.array(customerSchema),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.getAllCustomers,
	);

	server.get(
		'/:id',
		{
			schema: {
				description: 'Get a customer by ID',
				params: z.object({ id: z.string() }),
				response: {
					200: customerSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Customer'],
			},
		},
		customerController.getCustomerById,
	);

	server.get(
		'/plans/:email',
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
