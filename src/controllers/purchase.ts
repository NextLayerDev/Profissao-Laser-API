import type { FastifyReply, FastifyRequest } from 'fastify';
import { purchaseService } from '../services/purchase.js';

export const getPurchasesController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const user = request.currentUser;

		if (!user || !user.email) {
			return reply.status(401).send({ message: 'User email not found' });
		}

		const purchases = await purchaseService.listPurchases(user.email);
		return reply.send(purchases);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
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
	try {
		const subscription = await purchaseService.createSubscription(request.body);
		return reply.status(201).send(subscription);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createPurchaseController = async (
	request: FastifyRequest<{
		Body: {
			productId: string;
			amount: number;
			recorrencia: 'one_time' | 'month' | 'year';
		};
	}>,
	reply: FastifyReply,
) => {
	try {
		const user = request.currentUser;

		if (!user || !user.email) {
			return reply.status(401).send({ message: 'Authentication required' });
		}

		const purchase = await purchaseService.createPurchase({
			email: user.email,
			...request.body,
		});

		return reply.status(201).send(purchase);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getAllPurchasesController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const purchases = await purchaseService.listAllPurchases();
		return reply.send(purchases);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
