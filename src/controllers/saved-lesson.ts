import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { savedLessonRepository } from '../repositories/saved-lesson.js';
import { saveLessonSchema } from '../types/saved-lesson.js';

export const listSavedLessonsController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) return reply.status(401).send({ message: 'Unauthorized' });

		const saved = await savedLessonRepository.list(customerId);
		return reply.send(saved);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const saveLessonController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) return reply.status(401).send({ message: 'Unauthorized' });

		const { lessonId } = saveLessonSchema.parse(request.body);
		const saved = await savedLessonRepository.save(customerId, lessonId);
		return reply.status(201).send(saved);
	} catch (err) {
		const statusCode = (err as { statusCode?: number }).statusCode;
		const message = err instanceof Error ? err.message : 'Unknown error';
		if (statusCode === 404) return reply.status(404).send({ message });
		if (statusCode === 403) return reply.status(403).send({ message });
		return reply.status(500).send({ message });
	}
};

export const removeSavedLessonController = async (
	request: FastifyRequest<{ Params: { lessonId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) return reply.status(401).send({ message: 'Unauthorized' });

		const { lessonId } = z.object({ lessonId: z.uuid() }).parse(request.params);
		await savedLessonRepository.remove(customerId, lessonId);
		return reply.status(204).send();
	} catch (err) {
		const statusCode = (err as { statusCode?: number }).statusCode;
		const message = err instanceof Error ? err.message : 'Unknown error';
		if (statusCode === 404) return reply.status(404).send({ message });
		return reply.status(500).send({ message });
	}
};
