import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { progressRepository } from '../repositories/progress.js';
import { completeBodySchema, progressQuerySchema } from '../types/progress.js';

export const getCourseProgressController = async (
	request: FastifyRequest<{
		Params: { courseId: string };
		Querystring: { customerId?: string };
	}>,
	reply: FastifyReply,
) => {
	try {
		const { courseId } = z.object({ courseId: z.uuid() }).parse(request.params);
		const { customerId: queryCustomerId } = progressQuerySchema.parse(
			request.query,
		);

		// `currentCustomer` é null para staff (authenticateProgress deixa assim de
		// propósito, p/ o admin ler o progresso de OUTRO aluno via query). O
		// fallback final é a própria staff — é o que faz a Visão Aluno gravar
		// progresso na linha dela em vez de responder 400.
		const customerId =
			request.currentCustomer?.id ?? queryCustomerId ?? request.currentUser?.id;

		if (!customerId) {
			return reply.status(400).send({ message: 'customerId is required' });
		}

		const watchedLessonIds = await progressRepository.listByCourse(
			customerId,
			courseId,
		);

		return reply.send({ watchedLessonIds });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const completeLessonController = async (
	request: FastifyRequest<{
		Params: { lessonId: string };
		Body: { customerId?: string };
	}>,
	reply: FastifyReply,
) => {
	try {
		const { lessonId } = z.object({ lessonId: z.uuid() }).parse(request.params);
		const { customerId: bodyCustomerId } = completeBodySchema.parse(
			request.body,
		);

		// Mesma cadeia do GET: staff sem customerId explícito marca a aula p/ si.
		const customerId =
			request.currentCustomer?.id ?? bodyCustomerId ?? request.currentUser?.id;

		if (!customerId) {
			return reply.status(400).send({ message: 'customerId is required' });
		}

		const result = await progressRepository.complete(customerId, lessonId);

		return reply.status(201).send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
