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
	const user = request.currentUser;
	if (!user || !user.email) {
		return reply.status(401).send({ message: 'Authentication required' });
	}

	const { data: result, error } = await promoLinkService.createLink(
		request.body,
		user.email,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		if (message.includes('not configured for payments')) {
			return reply.status(400).send({ message });
		}
		if (message.includes('not found')) {
			return reply.status(404).send({ message });
		}
		return reply.status(500).send({ message });
	}
	return reply.status(201).send(result);
};

export const getPromoLinkInfoController = async (
	request: FastifyRequest<{ Params: { token: string } }>,
	reply: FastifyReply,
) => {
	const { data: result, error } = await promoLinkService.getLinkInfo(
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

export const redeemPromoLinkController = async (
	request: FastifyRequest<{
		Params: { token: string };
		Body: RedeemPromoLink;
	}>,
	reply: FastifyReply,
) => {
	const { data: result, error } = await promoLinkService.redeemLink(
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
		return reply.status(500).send({ message });
	}
	return reply.status(201).send(result);
};

export const updatePromoLinkStatusController = async (
	request: FastifyRequest<{
		Params: { id: string };
		Body: UpdatePromoLinkStatus;
	}>,
	reply: FastifyReply,
) => {
	const { data: result, error } = await promoLinkService.updateStatus(
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

export const listPromoLinksController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	const { data: result, error } = await promoLinkService.listLinks();
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(200).send(result);
};
