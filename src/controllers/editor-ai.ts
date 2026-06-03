import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	refundInvocation,
	resolveToolBilling,
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
	// Billing OPCIONAL pelo upvox (tool `ai_canvas`): cobrada → valida + settle;
	// não cobrada → roda grátis; cobrada sem invocation → 402 (anti-bypass).
	let invocationId: string | null = null;
	try {
		const body = editorAiRequestSchema.parse(request.body);
		const gate = await resolveToolBilling(
			customerId,
			AI_CANVAS_TOOL_KEY,
			body.invocation_id ?? null,
		);
		if (gate.mode === 'reject') {
			return reply.status(gate.status).send({ message: gate.message });
		}
		invocationId = gate.mode === 'paid' ? gate.invocationId : null;
		const result = await editorAiService.generateOrEdit(body);
		if (invocationId) await settleInvocation(customerId, invocationId);
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
		const gate = await resolveToolBilling(
			customerId,
			AI_CANVAS_TOOL_KEY,
			body.invocation_id ?? null,
		);
		if (gate.mode === 'reject') {
			return reply.status(gate.status).send({ message: gate.message });
		}
		invocationId = gate.mode === 'paid' ? gate.invocationId : null;
		const result = await editorAiService.removeBackground(body);
		if (invocationId) await settleInvocation(customerId, invocationId);
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
