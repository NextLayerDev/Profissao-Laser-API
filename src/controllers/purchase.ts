import type { FastifyReply, FastifyRequest } from 'fastify';
import { customerRepository } from '../repositories/customer.js';
import { purchaseService } from '../services/purchase.js';

export const getPurchasesController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const user = request.currentUser;

	if (!user || !user.email) {
		return reply.status(401).send({ message: 'User email not found' });
	}

	const { data: purchases, error } = await purchaseService.listPurchases(
		user.email,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(purchases);
};

export const createSubscriptionController = async (
	request: FastifyRequest<{
		Body: {
			email: string;
			stripeProductId: string;
			amount: number;
			interval: 'month' | 'year';
			intervalCount: number;
			endsAt: string;
		};
	}>,
	reply: FastifyReply,
) => {
	const { data: subscription, error } =
		await purchaseService.createSubscription(request.body);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(201).send(subscription);
};

export const createPurchaseController = async (
	request: FastifyRequest<{
		Body: { productId: string; companyName?: string; phone?: string };
	}>,
	reply: FastifyReply,
) => {
	const user = request.currentUser;

	if (!user || !user.email) {
		return reply.status(401).send({ message: 'Authentication required' });
	}

	const { data: purchase, error } = await purchaseService.createPurchase({
		email: user.email,
		productId: request.body.productId,
		companyName: request.body.companyName,
		phone: request.body.phone,
	});
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(201).send(purchase);
};

export const getAllPurchasesController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	const { data: purchases, error } = await purchaseService.listAllPurchases();
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(purchases);
};

export const getPaymentAttemptsController = async (
	request: FastifyRequest<{
		Querystring: {
			status?: 'succeeded' | 'failed' | 'all';
			limit?: number;
			starting_after?: string;
		};
	}>,
	reply: FastifyReply,
) => {
	const { data: attempts, error } = await purchaseService.listPaymentAttempts(
		request.query,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(attempts);
};

export const getRecurringSubscriptionsController = async (
	request: FastifyRequest<{
		Querystring: {
			status?: 'active' | 'trialing' | 'all';
			limit?: number;
			starting_after?: string;
		};
	}>,
	reply: FastifyReply,
) => {
	const { data: subscriptions, error } =
		await purchaseService.listAllRecurringSubscriptions(request.query);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(subscriptions);
};

export const upgradeSubscriptionController = async (
	request: FastifyRequest<{ Body: { productId: string } }>,
	reply: FastifyReply,
) => {
	const user = request.currentUser;
	if (!user || !user.email) {
		return reply.status(401).send({ message: 'Authentication required' });
	}
	const { data: result, error } = await purchaseService.changePlan(
		user.email,
		request.body.productId,
		'upgrade',
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(200).send(result);
};

export const downgradeSubscriptionController = async (
	request: FastifyRequest<{ Body: { productId: string } }>,
	reply: FastifyReply,
) => {
	const user = request.currentUser;
	if (!user || !user.email) {
		return reply.status(401).send({ message: 'Authentication required' });
	}
	const { data: result, error } = await purchaseService.changePlan(
		user.email,
		request.body.productId,
		'downgrade',
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(200).send(result);
};

export const adminChangePlanController = async (
	request: FastifyRequest<{
		Params: { id: string };
		Body: { productId: string };
	}>,
	reply: FastifyReply,
) => {
	const { data: customer, error: customerError } =
		await customerRepository.getCustomerById(request.params.id);
	if (customerError || !customer) {
		return reply.status(404).send({ message: 'Customer not found' });
	}
	const { data: result, error } = await purchaseService.changePlan(
		customer.email,
		request.body.productId,
		'downgrade',
		{ skipValidation: true },
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(200).send(result);
};
