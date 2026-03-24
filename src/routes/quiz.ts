import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, authenticateAdmin } from '@/middleware/auth.js';
import {
	addQuestionController,
	createQuizController,
	deleteQuestionController,
	deleteQuizController,
	getQuizController,
	updateQuestionController,
} from '../controllers/quiz.js';
import { ErrorSchema } from '../types/error.js';
import {
	createQuestionSchema,
	createQuizSchema,
	quizQuestionSchema,
	quizSchema,
	updateQuestionSchema,
} from '../types/quiz.js';

export async function quizRoute(server: FastifyInstance) {
	server.get(
		'/lesson/:lessonId/quiz',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Get the quiz for a lesson, including all questions and options.',
				params: z.object({ lessonId: z.string() }),
				response: {
					200: quizSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Quiz'],
				security: [{ bearerAuth: [] }],
			},
		},
		getQuizController,
	);

	server.post(
		'/lesson/:lessonId/quiz',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Create a quiz for a lesson.',
				params: z.object({ lessonId: z.string() }),
				body: createQuizSchema,
				response: {
					201: quizSchema,
					500: ErrorSchema,
				},
				tags: ['Quiz'],
				security: [{ bearerAuth: [] }],
			},
		},
		createQuizController,
	);

	server.delete(
		'/quiz/:quizId',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Delete a quiz and all its questions.',
				params: z.object({ quizId: z.string().uuid() }),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Quiz'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteQuizController,
	);

	server.post(
		'/quiz/:quizId/question',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Add a question to a quiz. Requires at least 2 options and exactly 1 correct answer.',
				params: z.object({ quizId: z.string().uuid() }),
				body: createQuestionSchema,
				response: {
					201: quizQuestionSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Quiz'],
				security: [{ bearerAuth: [] }],
			},
		},
		addQuestionController,
	);

	server.patch(
		'/question/:questionId',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Update a question. If options are sent, they fully replace the existing ones.',
				params: z.object({ questionId: z.string().uuid() }),
				body: updateQuestionSchema,
				response: {
					200: quizQuestionSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Quiz'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateQuestionController,
	);

	server.delete(
		'/question/:questionId',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Delete a question and all its options.',
				params: z.object({ questionId: z.string().uuid() }),
				response: {
					204: z.null(),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Quiz'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteQuestionController,
	);
}
