import type { FastifyReply, FastifyRequest } from 'fastify';
import { customerRepository } from '../repositories/customer.js';
import { productRepository } from '../repositories/product.js';
import { purchaseService } from '../services/purchase.js';

class CustomerController {
	async getCustomerById(
		request: FastifyRequest<{ Params: { id: string } }>,
		reply: FastifyReply,
	) {
		const { id } = request.params;
		const customer = await customerRepository.getCustomerById(id);
		if (!customer) reply.status(404).send({ message: 'Customer not found' });
		reply.status(200).send(customer);
	}

	async getAllCustomers(_request: FastifyRequest, reply: FastifyReply) {
		const customers = await customerRepository.getAllCustomers();
		if (!customers) reply.status(404).send({ message: 'Customers not found' });
		reply.status(200).send(customers);
	}

	async updateUser(
		request: FastifyRequest<{ Params: { id: string } }>,
		reply: FastifyReply,
	) {
		const customer = await customerRepository.getCustomerById(
			request.params.id,
		);
		if (!customer) reply.status(404).send({ message: 'Customer not found' });
		reply.status(200).send(customer);
	}

	async deleteUser(
		request: FastifyRequest<{ Params: { id: string } }>,
		reply: FastifyReply,
	) {
		const customer = await customerRepository.getCustomerById(
			request.params.id,
		);
		if (!customer) reply.status(404).send({ message: 'Customer not found' });
		reply.status(200).send(customer);
	}

	async getCustomerPlans(
		request: FastifyRequest<{ Params: { email: string } }>,
		reply: FastifyReply,
	) {
		const subscriptions = await purchaseService.listActiveSubscriptions(
			request.params.email,
		);

		if (subscriptions.length === 0) {
			reply
				.status(404)
				.send({ message: 'No active subscriptions found for this email.' });
			return;
		}

		const result = await Promise.all(
			subscriptions.map(async (sub) => {
				const product = sub.stripeProductId
					? await productRepository.findByStripeProductId(sub.stripeProductId)
					: null;

				return {
					id: sub.id,
					status: sub.status,
					product_name: product?.name ?? 'Unknown',
					slug: product?.slug ?? null,
				};
			}),
		);

		reply.status(200).send(result);
	}
}

export const customerController = new CustomerController();
