import type { FastifyReply, FastifyRequest } from 'fastify';
import { lessonService } from '../services/lesson.js';
import { createLessonSchema, updateLessonSchema } from '../types/lesson.js';

export const createLessonController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createLessonSchema.parse(request.body);
		const lesson = await lessonService.create(data);
		return reply.status(201).send(lesson);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const updateLessonController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updateLessonSchema.parse(request.body);
		const lesson = await lessonService.update(request.params.id, data);
		return reply.send(lesson);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Lesson not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const deleteLessonController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		await lessonService.delete(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Lesson not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const listLessonsController = async (
	request: FastifyRequest<{ Params: { moduleId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const lessons = await lessonService.listByModule(request.params.moduleId);
		return reply.send(lessons);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
