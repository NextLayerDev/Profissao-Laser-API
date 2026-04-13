import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	authenticate,
	authenticateAdmin,
	authenticateCustomer,
} from '@/middleware/auth.js';
import {
	assignRandomController,
	createCategoryController,
	createChatController,
	createDefaultQuestionController,
	deleteCategoryController,
	deleteDefaultQuestionController,
	getChatController,
	getTechnicianController,
	listAdminChatsController,
	listCategoriesController,
	listChatsController,
	listDefaultQuestionsController,
	listTechniciansController,
	reorderCategoriesController,
	reorderDefaultQuestionsController,
	sendMessageController,
	updateCategoryController,
	updateDefaultQuestionController,
} from '../controllers/doubt-chat.js';
import {
	chatMessageSchema,
	createDefaultQuestionSchema,
	createDoubtCategorySchema,
	defaultQuestionSchema,
	doubtCategorySchema,
	doubtChatSchema,
	doubtChatSummarySchema,
	reorderSchema,
	technicianSchema,
	updateDefaultQuestionSchema,
	updateDoubtCategorySchema,
} from '../types/doubt-chat.js';
import { ErrorSchema } from '../types/error.js';

export async function doubtChatRoute(server: FastifyInstance) {
	server.get(
		'/doubt-categories',
		{
			preHandler: [authenticate],
			schema: {
				description: 'List all doubt categories.',
				response: { 200: z.array(doubtCategorySchema), 500: ErrorSchema },
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		listCategoriesController,
	);

	server.post(
		'/doubt-categories',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Create a doubt category (staff only).',
				body: createDoubtCategorySchema,
				response: {
					201: doubtCategorySchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		createCategoryController,
	);

	server.post(
		'/doubt-categories/reorder',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Reorder doubt categories (staff only).',
				body: reorderSchema,
				response: { 204: z.null(), 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		reorderCategoriesController,
	);

	server.patch(
		'/doubt-categories/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Update a doubt category (staff only).',
				params: z.object({ id: z.string() }),
				body: updateDoubtCategorySchema,
				response: {
					200: doubtCategorySchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateCategoryController,
	);

	server.delete(
		'/doubt-categories/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Delete a doubt category (staff only).',
				params: z.object({ id: z.string() }),
				response: { 204: z.null(), 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteCategoryController,
	);

	server.get(
		'/technicians',
		{
			preHandler: [authenticate],
			schema: {
				description: 'List all technicians (platform users).',
				response: { 200: z.array(technicianSchema), 500: ErrorSchema },
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		listTechniciansController,
	);

	server.get(
		'/technicians/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Get a technician with their default questions.',
				params: z.object({ id: z.string() }),
				response: {
					200: technicianSchema.extend({
						defaultQuestions: z.array(defaultQuestionSchema),
					}),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		getTechnicianController,
	);

	server.get(
		'/technicians/:id/default-questions',
		{
			preHandler: [authenticate],
			schema: {
				description: 'List default qualification questions for a technician.',
				params: z.object({ id: z.string() }),
				response: { 200: z.array(defaultQuestionSchema), 500: ErrorSchema },
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		listDefaultQuestionsController,
	);

	server.post(
		'/technicians/:id/default-questions',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Create a default question for a technician (staff only).',
				params: z.object({ id: z.string() }),
				body: createDefaultQuestionSchema,
				response: {
					201: defaultQuestionSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		createDefaultQuestionController,
	);

	server.post(
		'/technicians/:id/default-questions/reorder',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Reorder default questions for a technician (staff only).',
				params: z.object({ id: z.string() }),
				body: reorderSchema,
				response: { 204: z.null(), 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		reorderDefaultQuestionsController,
	);

	server.patch(
		'/doubt-default-questions/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Update a default question (staff only).',
				params: z.object({ id: z.string() }),
				body: updateDefaultQuestionSchema,
				response: {
					200: defaultQuestionSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateDefaultQuestionController,
	);

	server.delete(
		'/doubt-default-questions/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Delete a default question (staff only).',
				params: z.object({ id: z.string() }),
				response: { 204: z.null(), 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteDefaultQuestionController,
	);

	server.get(
		'/doubt-chats',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: "List the current customer's doubt chats.",
				querystring: z.object({ status: z.string().optional() }),
				response: { 200: z.array(doubtChatSummarySchema), 500: ErrorSchema },
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		listChatsController,
	);

	server.post(
		'/doubt-chats',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Create a new doubt chat.',
				response: { 201: doubtChatSchema, 400: ErrorSchema },
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		createChatController,
	);

	server.get(
		'/doubt-chats/admin',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'List all doubt chats (staff only).',
				querystring: z.object({ categoryId: z.string().optional() }),
				response: {
					200: z.array(doubtChatSummarySchema),
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		listAdminChatsController,
	);

	server.get(
		'/doubt-chats/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Get a doubt chat with messages.',
				params: z.object({ id: z.string() }),
				response: {
					200: doubtChatSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		getChatController,
	);

	server.post(
		'/doubt-chats/:id/messages',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Send a message in a doubt chat (multipart/form-data with optional `content` field and optional `file`).',
				params: z.object({ id: z.string() }),
				response: { 201: chatMessageSchema, 400: ErrorSchema },
				tags: ['Doubt Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		sendMessageController,
	);

	server.post(
		'/doubt-chats/:id/assign-random',
		{
			schema: {
				description: 'Assign a random technician to a chat (staff only).',
				params: z.object({ id: z.string() }),
				response: { 200: doubtChatSchema, 403: ErrorSchema, 400: ErrorSchema },
				tags: ['Doubt Chat'],
			},
		},
		assignRandomController,
	);
}
