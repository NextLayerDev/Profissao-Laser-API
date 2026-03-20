import type { FastifyReply, FastifyRequest } from 'fastify';
import { promoLinkService } from '../services/promo-link.js';
import type {
	CreatePromoLink,
	RedeemPromoLink,
	UpdatePromoLinkStatus,
} from '../types/promo-link.js';

export const createPromoLinkController = async (
	request: FastifyRequest<{ Body: CreatePromoLink }>,
	reply: FastifyReply,
) => {
	try {
		const user = request.currentUser;
		if (!user || !user.email) {
			return reply.status(401).send({ message: 'Authentication required' });
		}

		const result = await promoLinkService.createLink(request.body, user.email);
		return reply.status(201).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		if (message.includes('not configured for payments')) {
			return reply.status(400).send({ message });
		}
		if (message.includes('not found')) {
			return reply.status(404).send({ message });
		}
		return reply.status(500).send({ message });
	}
};

export const getPromoLinkInfoController = async (
	request: FastifyRequest<{ Params: { token: string } }>,
	reply: FastifyReply,
) => {
	try {
		const result = await promoLinkService.getLinkInfo(request.params.token);
		return reply.status(200).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		if (message.includes('not found')) {
			return reply.status(404).send({ message });
		}
		if (
			message.includes('expired') ||
			message.includes('not active') ||
			message.includes('exhausted')
		) {
			return reply.status(410).send({ message });
		}
		return reply.status(500).send({ message });
	}
};

export const redeemPromoLinkController = async (
	request: FastifyRequest<{
		Params: { token: string };
		Body: RedeemPromoLink;
	}>,
	reply: FastifyReply,
) => {
	try {
		const result = await promoLinkService.redeemLink(
			request.params.token,
			request.body,
		);
		return reply.status(201).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		if (message.includes('not found')) {
			return reply.status(404).send({ message });
		}
		if (
			message.includes('expired') ||
			message.includes('not active') ||
			message.includes('exhausted')
		) {
			return reply.status(410).send({ message });
		}
		if (message.includes('already redeemed')) {
			return reply.status(409).send({ message });
		}
		if (message.includes('Invalid CPF')) {
			return reply.status(400).send({ message });
		}
		return reply.status(500).send({ message });
	}
};

export const updatePromoLinkStatusController = async (
	request: FastifyRequest<{
		Params: { id: string };
		Body: UpdatePromoLinkStatus;
	}>,
	reply: FastifyReply,
) => {
	try {
		const result = await promoLinkService.updateStatus(
			request.params.id,
			request.body,
		);
		return reply.status(200).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		if (message.includes('not found')) {
			return reply.status(404).send({ message });
		}
		return reply.status(500).send({ message });
	}
};

export const listPromoLinksController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const result = await promoLinkService.listLinks();
		return reply.status(200).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
