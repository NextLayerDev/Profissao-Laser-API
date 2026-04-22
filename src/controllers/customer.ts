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
		const { data: customer, error } = await customerService.getCustomerById(id);
		if (error) {
			return reply.status(500).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}
		if (!customer)
			return reply.status(404).send({ message: 'Customer not found' });

		reply.status(200).send(customer);
	}

	async getAllCustomers(_request: FastifyRequest, reply: FastifyReply) {
		const { data: customers, error } = await customerService.getAllCustomers();
		if (error) {
			return reply.status(500).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}
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

	async deleteCustomer(
		request: FastifyRequest<{ Body: { id: string } }>,
		reply: FastifyReply,
	) {
		const { id } = request.body;
		const { error } = await customerService.deleteCustomer(id);
		if (error) {
			return reply.status(500).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}
		reply.status(200).send({ message: 'Customer deleted' });
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
		const { data: result, error } = await customerService.blockCustomer(
			id,
			blocked,
		);
		if (error) {
			return reply.status(500).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}
		reply.status(200).send(result);
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
		const { error } = await customerService.changePassword(id, password);
		if (error) {
			return reply.status(500).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}
		reply.status(200).send({ message: 'Password updated' });
	}

	async getMySubscription(request: FastifyRequest, reply: FastifyReply) {
		const email = request.currentUser?.email;
		if (!email) return reply.status(401).send({ message: 'Unauthorized' });

		const { data: subscription, error } =
			await purchaseService.getSubscriptionDetails(email);
		if (error) {
			return reply.status(500).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}
		if (!subscription)
			return reply
				.status(404)
				.send({ message: 'No active subscription found.' });
		reply.status(200).send(subscription);
	}

	async cancelMySubscription(request: FastifyRequest, reply: FastifyReply) {
		const email = request.currentUser?.email;
		if (!email) return reply.status(401).send({ message: 'Unauthorized' });

		const { data: result, error } =
			await purchaseService.cancelSubscription(email);
		if (error) {
			return reply.status(500).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}
		if (!result)
			return reply
				.status(404)
				.send({ message: 'No active subscription found.' });
		reply.status(200).send(result);
	}

	async cancelCustomerSubscription(
		request: FastifyRequest<{
			Body: { email: string; subscriptionId: string };
		}>,
		reply: FastifyReply,
	) {
		const { data: result, error } =
			await purchaseService.cancelSubscriptionById(request.body);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			const status =
				message === 'Subscription not found'
					? 404
					: message === 'Subscription does not belong to this customer' ||
							message === 'Subscription is already cancelled'
						? 400
						: 500;
			return reply.status(status).send({ message });
		}
		reply.status(200).send(result);
	}

	async getCustomerPlans(
		request: FastifyRequest<{ Params: { email: string } }>,
		reply: FastifyReply,
	) {
		const { data: subscriptions, error } =
			await purchaseService.listActiveSubscriptions(request.params.email);
		if (error) {
			return reply.status(500).send({
				message: error instanceof Error ? error.message : 'Unknown error',
			});
		}

		if (!subscriptions || subscriptions.length === 0) {
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
					currentPeriodEnd: sub.currentPeriodEnd,
					cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
				};
			}),
		);

		reply.status(200).send(result);
	}
}

export const customerController = new CustomerController();
