import type { FastifyReply, FastifyRequest } from 'fastify';
import { uploadLessonVideo } from '../lib/storage.js';
import { lessonRepository } from '../repositories/lesson.js';
import { lessonService } from '../services/lesson.js';
import {
	createLessonSchema,
	reorderLessonsSchema,
	updateLessonSchema,
} from '../types/lesson.js';

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

export const uploadLessonVideoController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const file = await request.file();
		if (!file) return reply.status(400).send({ message: 'No file provided' });

		const buffer = await file.toBuffer();
		const ext = file.filename.split('.').pop() ?? 'mp4';
		const storagePath = `${request.params.id}/video/${crypto.randomUUID()}.${ext}`;

		const url = await uploadLessonVideo(buffer, storagePath, file.mimetype);
		const lesson = await lessonRepository.updateVideo(request.params.id, url);

		return reply.send(lesson);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Lesson not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const reorderLessonsController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const { lessonIds } = reorderLessonsSchema.parse(request.body);
		await lessonService.reorder(lessonIds);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
