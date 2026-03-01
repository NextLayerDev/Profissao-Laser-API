import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.js';
import {
	createLessonController,
	deleteLessonController,
	listLessonsController,
	reorderLessonsController,
	updateLessonController,
	uploadLessonVideoController,
} from '../controllers/lesson.js';
import {
	deleteMaterialController,
	listMaterialsController,
	uploadLessonFileController,
	uploadMaterialController,
} from '../controllers/material.js';
import { ErrorSchema } from '../types/error.js';
import {
	createLessonSchema,
	lessonSchema,
	reorderLessonsSchema,
	updateLessonSchema,
} from '../types/lesson.js';
import { materialSchema } from '../types/material.js';

export async function lessonRoute(server: FastifyInstance) {
	server.get(
		'/module/:moduleId/lessons',
		{
			preHandler: [authenticate],
			schema: {
				description: 'List all lessons of a module ordered by position.',
				params: z.object({ moduleId: z.string() }),
				response: {
					200: z.array(lessonSchema),
					500: ErrorSchema,
				},
				tags: ['Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		listLessonsController,
	);

	server.post(
		'/lesson',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Create a new lesson inside a module.',
				body: createLessonSchema,
				response: {
					201: lessonSchema,
					500: ErrorSchema,
				},
				tags: ['Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		createLessonController,
	);

	server.put(
		'/lesson/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Update a lesson.',
				params: z.object({ id: z.string() }),
				body: updateLessonSchema,
				response: {
					200: lessonSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateLessonController,
	);

	server.post(
		'/lesson/:id/video',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Upload a video for a lesson. Send as multipart/form-data with a single field: file.',
				params: z.object({ id: z.string() }),
				consumes: ['multipart/form-data'],
				response: {
					200: lessonSchema,
					400: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadLessonVideoController,
	);

	server.patch(
		'/lesson/reorder',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Reorder lessons by position in the given array.',
				body: reorderLessonsSchema,
				response: {
					204: z.null(),
					500: ErrorSchema,
				},
				tags: ['Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		reorderLessonsController,
	);

	server.delete(
		'/lesson/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Delete a lesson.',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteLessonController,
	);

	// Materials
	server.get(
		'/lesson/:lessonId/materials',
		{
			preHandler: [authenticate],
			schema: {
				description: 'List all support materials for a lesson.',
				params: z.object({ lessonId: z.string() }),
				response: {
					200: z.array(materialSchema),
					500: ErrorSchema,
				},
				tags: ['Materials'],
				security: [{ bearerAuth: [] }],
			},
		},
		listMaterialsController,
	);

	server.post(
		'/lesson/:lessonId/material',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Upload a support material (PDF, Word, image) to a lesson. Send as multipart/form-data with fields: file (required), name (optional).',
				params: z.object({ lessonId: z.string() }),
				consumes: ['multipart/form-data'],
				response: {
					201: materialSchema,
					400: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Materials'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadMaterialController,
	);

	server.post(
		'/lesson/:lessonId/file',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Upload a document file (PDF, Word, ODT or any file) to a lesson. Send as multipart/form-data with fields: file (required), name (optional).',
				params: z.object({ lessonId: z.string() }),
				consumes: ['multipart/form-data'],
				response: {
					201: materialSchema,
					400: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Materials'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadLessonFileController,
	);

	server.delete(
		'/lesson/:lessonId/material/:materialId',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Remove a support material from a lesson.',
				params: z.object({
					lessonId: z.string(),
					materialId: z.string(),
				}),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Materials'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteMaterialController,
	);
}
