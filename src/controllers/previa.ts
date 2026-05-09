import type { FastifyReply, FastifyRequest } from 'fastify';
import { DailyLimitError } from '../lib/previa-quota.js';
import { previaService } from '../services/previa.js';
import { generatePreviaSchema, updatePreviaSchema } from '../types/previa.js';

const VALIDATION_MESSAGES = new Set([
	'Imagens base e produto são obrigatórias',
	'Imagem do logo é obrigatória',
	'Texto para gravação é obrigatório',
	'Texto para pelo menos uma lente é obrigatório',
]);

function statusFor(message: string): number {
	if (message === 'Previa not found') return 404;
	if (VALIDATION_MESSAGES.has(message)) return 400;
	return 500;
}

export const generatePreviaController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const body = generatePreviaSchema.parse(request.body);
		const previa = await previaService.generate(customerId, body);
		return reply.status(201).send(previa);
	} catch (err) {
		// Limite diário atingido → 429 com payload estruturado para o front
		if (err instanceof DailyLimitError) {
			return reply.status(429).send({
				message: `Você atingiu o limite diário de ${err.limit} prévias. Faça upgrade do seu plano para gerar mais.`,
				code: 'DAILY_LIMIT_REACHED',
				limit: err.limit,
				used: err.used,
				remaining: 0,
				resetsAt: err.resetsAt,
			});
		}
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const getPreviaQuotaController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const quota = await previaService.getQuota(customerId);
		return reply.send(quota);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getPreviaHistoryController = async (
	request: FastifyRequest<{
		Querystring: { page?: number; limit?: number };
	}>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const page = request.query.page ?? 1;
		const limit = request.query.limit ?? 20;
		const result = await previaService.listHistory(customerId, page, limit);
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const updatePreviaController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const data = updatePreviaSchema.parse(request.body);
		const previa = await previaService.update(
			customerId,
			request.params.id,
			data,
		);
		return reply.send(previa);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const deletePreviaController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		await previaService.delete(customerId, request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};
