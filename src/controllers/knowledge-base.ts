import type { FastifyReply, FastifyRequest } from 'fastify';
import { withCapture } from '@/lib/sentry.js';
import { knowledgeBaseRepository } from '../repositories/knowledge-base.js';
import {
	type CreateKnowledgeBase,
	createKnowledgeBaseSchema,
	type ListKnowledgeBaseQuery,
	type UpdateKnowledgeBase,
	updateKnowledgeBaseSchema,
} from '../types/knowledge-base.js';

export const listKnowledgeBaseController = async (
	request: FastifyRequest<{ Querystring: ListKnowledgeBaseQuery }>,
	reply: FastifyReply,
) => {
	const { data, error } = await withCapture(() =>
		knowledgeBaseRepository.list(request.query),
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(data);
};

export const getKnowledgeBaseController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { data, error } = await withCapture(() =>
		knowledgeBaseRepository.findById(request.params.id),
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	if (!data) return reply.status(404).send({ message: 'Article not found' });
	return reply.send(data);
};

export const createKnowledgeBaseController = async (
	request: FastifyRequest<{ Body: CreateKnowledgeBase }>,
	reply: FastifyReply,
) => {
	const body = createKnowledgeBaseSchema.parse(request.body);
	const { data, error } = await withCapture(() =>
		knowledgeBaseRepository.create(body),
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(201).send(data);
};

export const updateKnowledgeBaseController = async (
	request: FastifyRequest<{
		Params: { id: string };
		Body: UpdateKnowledgeBase;
	}>,
	reply: FastifyReply,
) => {
	const body = updateKnowledgeBaseSchema.parse(request.body);
	const { data, error } = await withCapture(() =>
		knowledgeBaseRepository.update(request.params.id, body),
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.send(data);
};

export const deleteKnowledgeBaseController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { error } = await withCapture(() =>
		knowledgeBaseRepository.delete(request.params.id),
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
	return reply.status(204).send();
};
