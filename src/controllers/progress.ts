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

		const customerId = request.currentCustomer?.id ?? queryCustomerId;

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

		const customerId = request.currentCustomer?.id ?? bodyCustomerId;

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
