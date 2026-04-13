import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, authenticateCustomer } from '@/middleware/auth.js';
import {
	createDoubtController,
	createReplyController,
	listDoubtsController,
} from '../controllers/doubt.js';
import {
	getRatingController,
	upsertRatingController,
} from '../controllers/rating.js';
import {
	createDoubtSchema,
	createReplySchema,
	doubtSchema,
} from '../types/doubt.js';
import { ErrorSchema } from '../types/error.js';
import { createRatingSchema, ratingResponseSchema } from '../types/rating.js';

export async function doubtRoute(server: FastifyInstance) {
	server.get(
		'/lesson/:lessonId/doubts',
		{
			preHandler: [authenticate],
			schema: {
				description: 'List all doubts and replies for a lesson.',
				params: z.object({ lessonId: z.string() }),
				response: {
					200: z.array(doubtSchema),
					500: ErrorSchema,
				},
				tags: ['Doubts'],
				security: [{ bearerAuth: [] }],
			},
		},
		listDoubtsController,
	);

	server.post(
		'/lesson/:lessonId/doubt',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Submit a doubt for a lesson.',
				params: z.object({ lessonId: z.string() }),
				body: createDoubtSchema,
				response: {
					201: doubtSchema,
					400: ErrorSchema,
				},
				tags: ['Doubts'],
				security: [{ bearerAuth: [] }],
			},
		},
		createDoubtController,
	);

	server.post(
		'/doubt/:doubtId/reply',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Reply to a doubt (instructor only).',
				params: z.object({ doubtId: z.string() }),
				body: createReplySchema,
				response: {
					201: z.object({
						id: z.string(),
						content: z.string(),
						authorName: z.string(),
						createdAt: z.string(),
						isInstructor: z.literal(true),
					}),
					400: ErrorSchema,
				},
				tags: ['Doubts'],
				security: [{ bearerAuth: [] }],
			},
		},
		createReplyController,
	);

	server.get(
		'/lesson/:lessonId/rating',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Get the current customer rating and lesson average.',
				params: z.object({ lessonId: z.string() }),
				response: {
					200: ratingResponseSchema,
					500: ErrorSchema,
				},
				tags: ['Ratings'],
				security: [{ bearerAuth: [] }],
			},
		},
		getRatingController,
	);

	server.post(
		'/lesson/:lessonId/rating',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Submit or update a star rating for a lesson.',
				params: z.object({ lessonId: z.string() }),
				body: createRatingSchema,
				response: {
					200: ratingResponseSchema,
					400: ErrorSchema,
				},
				tags: ['Ratings'],
				security: [{ bearerAuth: [] }],
			},
		},
		upsertRatingController,
	);
}
