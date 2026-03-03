import type { FastifyReply, FastifyRequest } from 'fastify';
import { doubtRepository } from '../repositories/doubt.js';
import { createDoubtSchema, createReplySchema } from '../types/doubt.js';

export const listDoubtsController = async (
	request: FastifyRequest<{ Params: { lessonId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { lessonId } = request.params;
		const doubts = await doubtRepository.listByLesson(lessonId);
		return reply.send(doubts);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createDoubtController = async (
	request: FastifyRequest<{ Params: { lessonId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { lessonId } = request.params;
		const { content } = createDoubtSchema.parse(request.body);
		const customerId = request.currentCustomer?.id ?? '';
		const doubt = await doubtRepository.create(lessonId, customerId, content);
		return reply.status(201).send(doubt);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const createReplyController = async (
	request: FastifyRequest<{ Params: { doubtId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { doubtId } = request.params;
		const { content } = createReplySchema.parse(request.body);
		const userId = request.currentUser?.id ?? '';
		const userName =
			request.currentUser?.user_metadata?.name ??
			request.currentUser?.email ??
			'Instrutor';
		const replyData = await doubtRepository.addReply(
			doubtId,
			userId,
			userName,
			content,
		);
		return reply.status(201).send(replyData);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};
