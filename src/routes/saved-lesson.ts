import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateCustomer } from '@/middleware/auth.js';
import {
	listSavedLessonsController,
	removeSavedLessonController,
	saveLessonController,
} from '../controllers/saved-lesson.js';
import { ErrorSchema } from '../types/error.js';
import { savedLessonSchema, saveLessonSchema } from '../types/saved-lesson.js';

export async function savedLessonRoute(server: FastifyInstance) {
	server.get(
		'/customer/saved-lessons',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Returns all saved lessons for the authenticated customer.',
				response: {
					200: z.array(savedLessonSchema),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Saved Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		listSavedLessonsController,
	);

	server.post(
		'/customer/saved-lessons',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Saves a lesson for the authenticated customer (idempotent).',
				body: saveLessonSchema,
				response: {
					201: savedLessonSchema,
					401: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Saved Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		saveLessonController,
	);

	server.delete(
		'/customer/saved-lessons/:lessonId',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Removes a saved lesson for the authenticated customer.',
				params: z.object({ lessonId: z.uuid() }),
				response: {
					204: z.null(),
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Saved Lessons'],
				security: [{ bearerAuth: [] }],
			},
		},
		removeSavedLessonController,
	);
}
