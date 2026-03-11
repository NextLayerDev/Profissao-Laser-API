import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	createBunnyStreamUpload,
	getBunnyVideoUrl,
	uploadLessonVideo,
} from '../lib/storage.js';
import { lessonRepository } from '../repositories/lesson.js';
import { lessonService } from '../services/lesson.js';
import {
	confirmVideoUploadSchema,
	createLessonSchema,
	presignedVideoUrlSchema,
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

export const createPresignedVideoUrlController = async (
	request: FastifyRequest<{
		Params: { id: string };
		Body: { filename?: string };
	}>,
	reply: FastifyReply,
) => {
	try {
		const { filename } = presignedVideoUrlSchema.parse(request.body ?? {});
		const lesson = await lessonRepository.findById(request.params.id);
		if (!lesson) return reply.status(404).send({ message: 'Lesson not found' });

		const title =
			filename ?? `lesson-${request.params.id}-${crypto.randomUUID()}`;
		const result = await createBunnyStreamUpload(title);
		return reply.send({
			...result,
			libraryId: process.env.BUNNY_STREAM_LIBRARY_ID,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Lesson not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const confirmVideoUploadController = async (
	request: FastifyRequest<{
		Params: { id: string };
		Body: { videoId: string };
	}>,
	reply: FastifyReply,
) => {
	try {
		const { videoId } = confirmVideoUploadSchema.parse(request.body);
		const lessonId = request.params.id;
		const url = getBunnyVideoUrl(videoId);
		const lesson = await lessonRepository.updateVideo(lessonId, url);
		return reply.send(lesson);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Lesson not found' ? 404 : 500;
		return reply.status(status).send({ message });
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
