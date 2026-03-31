import type { FastifyReply, FastifyRequest } from 'fastify';
import { customerRepository } from '../repositories/customer.js';
import { productRepository } from '../repositories/product.js';
import { customerService } from '../services/customer.js';
import { purchaseService } from '../services/purchase.js';

class CustomerController {
	async getCustomerById(
		request: FastifyRequest<{ Params: { id: string } }>,
		reply: FastifyReply,
	) {
		const { id } = request.params;
		try {
			const customer = await customerService.getCustomerById(id);
			if (!customer)
				return reply.status(404).send({ message: 'Customer not found' });

			reply.status(200).send(customer);
		} catch (error) {
			reply.status(500).send({ message: (error as Error).message });
		}
	}

	async getAllCustomers(_request: FastifyRequest, reply: FastifyReply) {
		try {
			const customers = await customerService.getAllCustomers();
			reply.status(200).send(customers);
		} catch (error) {
			reply.status(500).send({ message: (error as Error).message });
		}
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

	async deleteCustomer(
		request: FastifyRequest<{ Body: { id: string } }>,
		reply: FastifyReply,
	) {
		const { id } = request.body;
		try {
			await customerService.deleteCustomer(id);
			reply.status(200).send({ message: 'Customer deleted' });
		} catch (error) {
			reply.status(500).send({ message: (error as Error).message });
		}
	}

	async blockCustomer(
		request: FastifyRequest<{
			Params: { id: string };
			Body: { blocked: boolean };
		}>,
		reply: FastifyReply,
	) {
		const { id } = request.params;
		const { blocked } = request.body;
		try {
			const result = await customerService.blockCustomer(id, blocked);
			reply.status(200).send(result);
		} catch (error) {
			reply.status(500).send({ message: (error as Error).message });
		}
	}

	async changePassword(
		request: FastifyRequest<{
			Params: { id: string };
			Body: { password: string };
		}>,
		reply: FastifyReply,
	) {
		const { id } = request.params;
		const { password } = request.body;
		try {
			await customerService.changePassword(id, password);
			reply.status(200).send({ message: 'Password updated' });
		} catch (error) {
			reply.status(500).send({ message: (error as Error).message });
		}
	}

	async getMySubscription(request: FastifyRequest, reply: FastifyReply) {
		const email = request.currentUser?.email;
		if (!email) return reply.status(401).send({ message: 'Unauthorized' });

		try {
			const subscription = await purchaseService.getSubscriptionDetails(email);
			if (!subscription)
				return reply
					.status(404)
					.send({ message: 'No active subscription found.' });
			reply.status(200).send(subscription);
		} catch (error) {
			reply.status(500).send({ message: (error as Error).message });
		}
	}

	async cancelMySubscription(request: FastifyRequest, reply: FastifyReply) {
		const email = request.currentUser?.email;
		if (!email) return reply.status(401).send({ message: 'Unauthorized' });

		try {
			const result = await purchaseService.cancelSubscription(email);
			if (!result)
				return reply
					.status(404)
					.send({ message: 'No active subscription found.' });
			reply.status(200).send(result);
		} catch (error) {
			reply.status(500).send({ message: (error as Error).message });
		}
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
