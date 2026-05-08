import type { FastifyReply, FastifyRequest } from 'fastify';
import { editorAiService } from '../services/editor-ai.js';
import {
	applyColorRequestSchema,
	editorAiRequestSchema,
	removeBackgroundRequestSchema,
} from '../types/editor-ai.js';

function statusFor(message: string): number {
	if (message.includes('Limite de requisições')) return 429;
	if (message.includes('Chave da API não configurada')) return 500;
	if (message.includes('Falha ao baixar modelo U2-Net')) return 503;
	if (message.includes('Imagem inválida')) return 400;
	if (message.includes('descreva o que você deseja')) return 400;
	if (message.startsWith('IA não gerou imagem')) return 400;
	return 500;
}

export const editorAiController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const body = editorAiRequestSchema.parse(request.body);
		const result = await editorAiService.generateOrEdit(body);
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const editorRemoveBackgroundController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const body = removeBackgroundRequestSchema.parse(request.body);
		const result = await editorAiService.removeBackground(body);
		return reply.send(result);
	} catch (err) {
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
