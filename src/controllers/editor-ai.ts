import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	getInvocation,
	refundInvocation,
	settleInvocation,
} from '../lib/upvox-tools.js';
import { editorAiService } from '../services/editor-ai.js';
import {
	applyColorRequestSchema,
	editorAiRequestSchema,
	removeBackgroundRequestSchema,
} from '../types/editor-ai.js';

const AI_CANVAS_TOOL_KEY = 'ai_canvas';

function statusFor(message: string): number {
	if (message.includes('Limite de requisições')) return 429;
	if (message.includes('Chave da API não configurada')) return 500;
	if (message.includes('Imagem inválida')) return 400;
	if (message.includes('descreva o que você deseja')) return 400;
	if (message.startsWith('IA não gerou imagem')) return 400;
	if (message.startsWith('IA não retornou imagem')) return 400;
	return 500;
}

export const editorAiController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId) {
		return reply.status(403).send({ message: 'Customer not found' });
	}
	// Billing pelo upvox (tool `ai_canvas`): valida a invocation paga, roda, e
	// settle/refund. Sem invocation válida o motor não roda.
	let invocationId: string | null = null;
	try {
		const body = editorAiRequestSchema.parse(request.body);
		invocationId = body.invocation_id;
		const inv = await getInvocation(customerId, invocationId);
		if (
			!inv ||
			inv.status !== 'pending' ||
			inv.tool_key !== AI_CANVAS_TOOL_KEY ||
			inv.customer_id !== customerId
		) {
			invocationId = null; // not ours to refund
			return reply.status(403).send({ message: 'invalid_invocation' });
		}
		const result = await editorAiService.generateOrEdit(body);
		await settleInvocation(customerId, invocationId);
		return reply.send(result);
	} catch (err) {
		if (invocationId) await refundInvocation(customerId, invocationId);
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const editorRemoveBackgroundController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId) {
		return reply.status(403).send({ message: 'Customer not found' });
	}
	let invocationId: string | null = null;
	try {
		const body = removeBackgroundRequestSchema.parse(request.body);
		invocationId = body.invocation_id;
		const inv = await getInvocation(customerId, invocationId);
		if (
			!inv ||
			inv.status !== 'pending' ||
			inv.tool_key !== AI_CANVAS_TOOL_KEY ||
			inv.customer_id !== customerId
		) {
			invocationId = null; // not ours to refund
			return reply.status(403).send({ message: 'invalid_invocation' });
		}
		const result = await editorAiService.removeBackground(body);
		await settleInvocation(customerId, invocationId);
		return reply.send(result);
	} catch (err) {
		if (invocationId) await refundInvocation(customerId, invocationId);
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const editorApplyColorController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const body = applyColorRequestSchema.parse(request.body);
		const result = await editorAiService.applyColor(body);
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};
