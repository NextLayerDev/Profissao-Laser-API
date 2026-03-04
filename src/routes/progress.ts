import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateProgress } from '@/middleware/auth.js';
import {
	completeLessonController,
	getCourseProgressController,
} from '../controllers/progress.js';
import { ErrorSchema } from '../types/error.js';
import {
	completeBodySchema,
	completionSchema,
	courseProgressSchema,
	progressQuerySchema,
} from '../types/progress.js';

export async function progressRoute(server: FastifyInstance) {
	server.get(
		'/course/:courseId/progress',
		{
			preHandler: [authenticateProgress],
			schema: {
				description:
					'Returns watched lesson IDs for the customer in a course. Admins pass ?customerId=<uuid>.',
				params: z.object({ courseId: z.uuid() }),
				querystring: progressQuerySchema,
				response: {
					200: courseProgressSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Progress'],
				security: [{ bearerAuth: [] }],
			},
		},
		getCourseProgressController,
	);

	server.post(
		'/lesson/:lessonId/complete',
		{
			preHandler: [authenticateProgress],
			schema: {
				description:
					'Marks a lesson as complete (upsert, idempotent). Admins pass { customerId } in body.',
				params: z.object({ lessonId: z.uuid() }),
				body: completeBodySchema,
				response: {
					201: completionSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Progress'],
				security: [{ bearerAuth: [] }],
			},
		},
		completeLessonController,
	);
}
