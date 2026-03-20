import type { FastifyReply, FastifyRequest } from 'fastify';
import { paymentLinkService } from '../services/payment-link.js';
import type {
	CreatePaymentLink,
	RedeemPaymentLink,
} from '../types/payment-link.js';

export const listPaymentLinksController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const result = await paymentLinkService.listLinks();
		return reply.status(200).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createPaymentLinkController = async (
	request: FastifyRequest<{ Body: CreatePaymentLink }>,
	reply: FastifyReply,
) => {
	try {
		const user = request.currentUser;
		if (!user || !user.email) {
			return reply.status(401).send({ message: 'Authentication required' });
		}

		const result = await paymentLinkService.createLink(
			request.body,
			user.email,
		);
		return reply.status(201).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		if (
			message.includes('Invalid CPF') ||
			message.includes('without system class') ||
			message.includes('not configured for payments')
		) {
			return reply.status(400).send({ message });
		}
		if (message.includes('not found')) {
			return reply.status(404).send({ message });
		}
		return reply.status(500).send({ message });
	}
};

export const getPaymentLinkInfoController = async (
	request: FastifyRequest<{ Params: { token: string } }>,
	reply: FastifyReply,
) => {
	try {
		const result = await paymentLinkService.getLinkInfo(request.params.token);
		return reply.status(200).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		if (message.includes('not found')) {
			return reply.status(404).send({ message });
		}
		if (message.includes('expired') || message.includes('already been used')) {
			return reply.status(410).send({ message });
		}
		return reply.status(500).send({ message });
	}
};

export const redeemPaymentLinkController = async (
	request: FastifyRequest<{
		Params: { token: string };
		Body: RedeemPaymentLink;
	}>,
	reply: FastifyReply,
) => {
	try {
		const result = await paymentLinkService.redeemLink(
			request.params.token,
			request.body,
		);
		return reply.status(201).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		if (message.includes('not found')) {
			return reply.status(404).send({ message });
		}
		if (message.includes('expired') || message.includes('already been used')) {
			return reply.status(410).send({ message });
		}
		if (message.includes('does not match')) {
			return reply.status(403).send({ message });
		}
		return reply.status(500).send({ message });
	}
};
