import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.js';
import {
	createLessonController,
	deleteLessonController,
	listLessonsController,
	updateLessonController,
} from '../controllers/lesson.js';
import { ErrorSchema } from '../types/error.js';
import {
	createLessonSchema,
	lessonSchema,
	updateLessonSchema,
} from '../types/lesson.js';

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
}
