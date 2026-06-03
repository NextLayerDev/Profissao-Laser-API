import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	FONT_OPTIONS,
	LASER_OPTIONS,
	LASER_RANGES,
} from '../lib/previa-options.js';
import {
	refundInvocation,
	resolveToolBilling,
	settleInvocation,
} from '../lib/upvox-tools.js';
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
	const customerId = request.currentCustomer?.id;
	let invocationId: string | null = null;
	try {
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const body = generatePreviaSchema.parse(request.body);

		// Billing OPCIONAL (tool `previa`): com invocation paga → valida + settle;
		// não cobrada → roda grátis; cobrada sem id → 402 (sem bypass).
		const gate = await resolveToolBilling(
			customerId,
			'previa',
			body.invocation_id ?? null,
		);
		if (gate.mode === 'reject') {
			return reply.status(gate.status).send({ message: gate.message });
		}
		invocationId = gate.mode === 'paid' ? gate.invocationId : null;

		const previa = await previaService.generate(customerId, body);
		if (invocationId) await settleInvocation(customerId, invocationId);
		return reply.status(201).send(previa);
	} catch (err) {
		if (invocationId && customerId) {
			await refundInvocation(customerId, invocationId);
		}
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
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
