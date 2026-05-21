import type { FastifyReply, FastifyRequest } from 'fastify';
import { InsufficientCreditsError } from '../lib/credit-errors.js';
import {
	FONT_OPTIONS,
	LASER_OPTIONS,
	LASER_RANGES,
} from '../lib/previa-options.js';
import { DailyLimitError } from '../lib/previa-quota.js';
import { creditService } from '../services/credit.js';
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
	if (message === "Marca d'água não cadastrada") return 400;
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
			const customerId = request.currentCustomer?.id;
			let creditOption: {
				cost: number;
				balance: number;
				canUseCredits: boolean;
			} | null = null;
			if (customerId) {
				try {
					const [{ balance }, costs] = await Promise.all([
						creditService.getBalance(customerId),
						creditService.listCosts(),
					]);
					const cost = costs.find((c) => c.feature === 'previa')?.cost ?? 1;
					creditOption = {
						cost,
						balance,
						canUseCredits: balance >= cost,
					};
				} catch {
					creditOption = null;
				}
			}
			return reply.status(429).send({
				message: `Você atingiu o limite diário de ${err.limit} prévias. Use créditos para gerar mais.`,
				code: 'DAILY_LIMIT_REACHED',
				limit: err.limit,
				used: err.used,
				remaining: 0,
				resetsAt: err.resetsAt,
				creditOption,
			});
		}
		if (err instanceof InsufficientCreditsError) {
			return reply.status(402).send({
				message: err.message,
				reason: 'insufficient_balance',
				feature: err.feature,
				cost: err.cost,
				balance: err.balance,
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

// Catálogo estático de opções pro frontend montar os seletores —
// sem acesso a DB, não depende do customer.
export const getPreviaOptionsController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	return reply.send({
		tamanho: LASER_OPTIONS.tamanho,
		posicao: LASER_OPTIONS.posicao,
		intensidade: LASER_OPTIONS.intensidade,
		profundidade: LASER_OPTIONS.profundidade,
		tamanhoNome: LASER_OPTIONS.tamanhoNome,
		material: LASER_OPTIONS.material,
		estiloGravacao: LASER_OPTIONS.estiloGravacao,
		acabamentoSuperficie: LASER_OPTIONS.acabamentoSuperficie,
		moldura: LASER_OPTIONS.moldura,
		posicaoTextoRelLogo: LASER_OPTIONS.posicaoTextoRelLogo,
		espacamentoLogoTexto: LASER_OPTIONS.espacamentoLogoTexto,
		tipoVisualizacao: LASER_OPTIONS.tipoVisualizacao,
		anguloCamera: LASER_OPTIONS.anguloCamera,
		iluminacao: LASER_OPTIONS.iluminacao,
		fundoCena: LASER_OPTIONS.fundoCena,
		orientacaoLogo: LASER_OPTIONS.orientacaoLogo,
		orientacaoNome: LASER_OPTIONS.orientacaoNome,
		comNome: LASER_OPTIONS.comNome,
		fontes: FONT_OPTIONS,
		ranges: LASER_RANGES,
	});
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

/* ─── Admin: usage stats + users ──────────────────────────────────────── */

export const getPreviaUsageStatsController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const stats = await previaService.getUsageStats();
		return reply.send(stats);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getPreviaUsageUsersController = async (
	request: FastifyRequest<{
		Querystring: { page?: number; limit?: number; search?: string };
	}>,
	reply: FastifyReply,
) => {
	try {
		const page = request.query.page ?? 1;
		const limit = request.query.limit ?? 20;
		const search = request.query.search;
		const result = await previaService.listUsageUsers({ page, limit, search });
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
