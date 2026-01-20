import type { User } from '@supabase/supabase-js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { purchaseService } from '@/services/purchase.service';

export const getPurchasesController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const user = request.user as User;

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
