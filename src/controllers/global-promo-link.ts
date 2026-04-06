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
	const user = request.currentUser;
	if (!user || !user.email) {
		return reply.status(401).send({ message: 'Authentication required' });
	}

	const { data: result, error } = await globalPromoLinkService.createLink(
		request.body,
		user.email,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(201).send(result);
};

export const getGlobalPromoLinkInfoController = async (
	request: FastifyRequest<{ Params: { token: string } }>,
	reply: FastifyReply,
) => {
	const { data: result, error } = await globalPromoLinkService.getLinkInfo(
		request.params.token,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
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
	return reply.status(200).send(result);
};

export const redeemGlobalPromoLinkController = async (
	request: FastifyRequest<{
		Params: { token: string };
		Body: RedeemGlobalPromoLink;
	}>,
	reply: FastifyReply,
) => {
	const { data: result, error } = await globalPromoLinkService.redeemLink(
		request.params.token,
		request.body,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
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
	return reply.status(201).send(result);
};

export const updateGlobalPromoLinkStatusController = async (
	request: FastifyRequest<{
		Params: { id: string };
		Body: UpdateGlobalPromoLinkStatus;
	}>,
	reply: FastifyReply,
) => {
	const { data: result, error } = await globalPromoLinkService.updateStatus(
		request.params.id,
		request.body,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		if (message.includes('not found')) {
			return reply.status(404).send({ message });
		}
		return reply.status(500).send({ message });
	}
	return reply.status(200).send(result);
};

export const listGlobalPromoLinksController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	const { data: result, error } = await globalPromoLinkService.listLinks();
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(200).send(result);
};
