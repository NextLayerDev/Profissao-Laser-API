import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { customerController } from '@/controllers/customer';
import { authenticate } from '@/middleware/auth';
import { customerSchema } from '@/types/customer';
import { ErrorSchema } from '@/types/error';

export async function customerRoutes(server: FastifyInstance) {
	server.get(
		'/customers',
		{
			preHandler: [authenticate],
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
		'/customer/:id',
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
}
