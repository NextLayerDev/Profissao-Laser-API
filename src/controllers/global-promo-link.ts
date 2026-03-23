import type { FastifyReply, FastifyRequest } from 'fastify';
import { globalPromoLinkService } from '../services/global-promo-link.js';
import type {
	CreateGlobalPromoLink,
	RedeemGlobalPromoLink,
	UpdateGlobalPromoLinkStatus,
} from '../types/global-promo-link.js';

export const createGlobalPromoLinkController = async (
	request: FastifyRequest<{ Body: CreateGlobalPromoLink }>,
	reply: FastifyReply,
) => {
	try {
		const user = request.currentUser;
		if (!user || !user.email) {
			return reply.status(401).send({ message: 'Authentication required' });
		}

		const result = await globalPromoLinkService.createLink(
			request.body,
			user.email,
		);
		return reply.status(201).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getGlobalPromoLinkInfoController = async (
	request: FastifyRequest<{ Params: { token: string } }>,
	reply: FastifyReply,
) => {
	try {
		const result = await globalPromoLinkService.getLinkInfo(
			request.params.token,
		);
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

export const redeemGlobalPromoLinkController = async (
	request: FastifyRequest<{
		Params: { token: string };
		Body: RedeemGlobalPromoLink;
	}>,
	reply: FastifyReply,
) => {
	try {
		const result = await globalPromoLinkService.redeemLink(
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
		if (message.includes('not configured for payments')) {
			return reply.status(400).send({ message });
		}
		return reply.status(500).send({ message });
	}
};

export const updateGlobalPromoLinkStatusController = async (
	request: FastifyRequest<{
		Params: { id: string };
		Body: UpdateGlobalPromoLinkStatus;
	}>,
	reply: FastifyReply,
) => {
	try {
		const result = await globalPromoLinkService.updateStatus(
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

export const listGlobalPromoLinksController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const result = await globalPromoLinkService.listLinks();
		return reply.status(200).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
