import type { FastifyInstance } from 'fastify';
import {
	getCustomersController,
	updateCustomerController,
} from '@/controllers/customer.controller';
import {
	CustomerSchema,
	UpdateCustomerSchema,
} from '@/types/Schemas/customer.schema';

export async function customerRoute(server: FastifyInstance) {
	server.get(
		'/customers',
		{
			schema: CustomerSchema,
		},
		getCustomersController,
	);

	server.put(
		'/customers/:id',
		{
			schema: UpdateCustomerSchema,
		},
		updateCustomerController,
	);
}
