import type { FastifyReply, FastifyRequest } from 'fastify';
import { UpvoxApiError } from '../lib/upvox-client.js';
import { reserveUpvoxTool } from '../lib/upvox-guard.js';
import { replyUpvoxError } from '../lib/upvox-reply.js';
import { editorAiService } from '../services/editor-ai.js';
import {
	applyColorRequestSchema,
	editorAiRequestSchema,
	removeBackgroundRequestSchema,
} from '../types/editor-ai.js';

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
	const jwt = request.headers.authorization ?? '';
	if (!jwt) {
		return reply.status(401).send({ message: 'Missing Authorization header' });
	}

	let body: ReturnType<typeof editorAiRequestSchema.parse>;
	try {
		body = editorAiRequestSchema.parse(request.body);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Invalid payload';
		return reply.status(400).send({ message });
	}

	let usage: Awaited<ReturnType<typeof reserveUpvoxTool>>;
	try {
		usage = await reserveUpvoxTool({
			jwt,
			customerId,
			toolKey: body.toolKey,
			courseSlug: body.courseSlug,
			unlimited: request.isUnlimitedCustomer,
		});
	} catch (err) {
		return replyUpvoxError(err, reply);
	}

	try {
		const result = await editorAiService.generateOrEdit(body);
		await usage.commit();
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		await usage.rollback(`editor-ai.generateOrEdit: ${message}`);
		if (err instanceof UpvoxApiError) return replyUpvoxError(err, reply);
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
	const jwt = request.headers.authorization ?? '';
	if (!jwt) {
		return reply.status(401).send({ message: 'Missing Authorization header' });
	}

	let body: ReturnType<typeof removeBackgroundRequestSchema.parse>;
	try {
		body = removeBackgroundRequestSchema.parse(request.body);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Invalid payload';
		return reply.status(400).send({ message });
	}

	let usage: Awaited<ReturnType<typeof reserveUpvoxTool>>;
	try {
		usage = await reserveUpvoxTool({
			jwt,
			customerId,
			toolKey: body.toolKey,
			courseSlug: body.courseSlug,
			unlimited: request.isUnlimitedCustomer,
		});
	} catch (err) {
		return replyUpvoxError(err, reply);
	}

	try {
		const result = await editorAiService.removeBackground(body);
		await usage.commit();
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		await usage.rollback(`editor-ai.removeBackground: ${message}`);
		if (err instanceof UpvoxApiError) return replyUpvoxError(err, reply);
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
