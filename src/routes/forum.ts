import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	acceptForumReplyController,
	createForumCategoryController,
	createForumPostController,
	createForumReplyController,
	deleteForumCategoryController,
	deleteForumPostController,
	deleteForumReplyController,
	getForumPostController,
	listForumCategoriesController,
	listForumPostsController,
	suggestForumCategoryController,
	updateForumCategoryController,
	updateForumPostController,
	updateForumReplyController,
	upvoteForumPostController,
	upvoteForumReplyController,
} from '../controllers/forum.js';
import { authenticateCustomer } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	createForumCategorySchema,
	createForumPostSchema,
	createForumReplySchema,
	forumCategorySchema,
	forumPostSchema,
	forumPostsResponseSchema,
	suggestForumCategoryResponseSchema,
	suggestForumCategorySchema,
	updateForumCategorySchema,
	updateForumPostSchema,
	updateForumReplySchema,
} from '../types/forum.js';

export async function forumRoute(server: FastifyInstance) {
	server.get(
		'/forum/categories',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'List forum categories.',
				response: { 200: z.array(forumCategorySchema), 500: ErrorSchema },
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		listForumCategoriesController,
	);

	server.post(
		'/forum/suggest-category',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Suggest (and create if needed) the best forum category for a thread, based on its title/content. AI-powered with keyword fallback.',
				body: suggestForumCategorySchema,
				response: {
					200: suggestForumCategoryResponseSchema,
					400: ErrorSchema,
				},
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		suggestForumCategoryController,
	);

	server.post(
		'/forum/category',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Create a forum category (any authenticated member; name is deduped case-insensitively).',
				body: createForumCategorySchema,
				response: {
					201: forumCategorySchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		createForumCategoryController,
	);

	server.patch(
		'/forum/category/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Update a forum category (admin only).',
				params: z.object({ id: z.string() }),
				body: updateForumCategorySchema,
				response: {
					200: forumCategorySchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateForumCategoryController,
	);

	server.delete(
		'/forum/category/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Delete a forum category (admin only).',
				params: z.object({ id: z.string() }),
				response: { 204: z.null(), 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteForumCategoryController,
	);

	server.get(
		'/forum/posts',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'List forum posts (paginated, filterable).',
				querystring: z.object({
					page: z.string().optional(),
					limit: z.string().optional(),
					categoryId: z.string().optional(),
					search: z.string().optional(),
					sort: z.enum(['recent', 'top', 'unanswered']).optional(),
				}),
				response: { 200: forumPostsResponseSchema, 500: ErrorSchema },
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		listForumPostsController,
	);

	server.get(
		'/forum/post/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Get a forum post with its replies.',
				params: z.object({ id: z.string() }),
				response: { 200: forumPostSchema, 404: ErrorSchema },
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		getForumPostController,
	);

	server.post(
		'/forum/post',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Create a forum post.',
				body: createForumPostSchema,
				response: { 201: forumPostSchema, 400: ErrorSchema },
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		createForumPostController,
	);

	server.patch(
		'/forum/post/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Update a forum post (author or admin).',
				params: z.object({ id: z.string() }),
				body: updateForumPostSchema,
				response: { 200: forumPostSchema, 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateForumPostController,
	);

	server.delete(
		'/forum/post/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Delete a forum post (author or admin).',
				params: z.object({ id: z.string() }),
				response: { 204: z.null(), 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteForumPostController,
	);

	server.post(
		'/forum/post/:id/upvote',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Toggle upvote on a forum post.',
				params: z.object({ id: z.string() }),
				response: { 200: forumPostSchema, 400: ErrorSchema },
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		upvoteForumPostController,
	);

	server.post(
		'/forum/post/:id/reply',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Add a reply to a forum post.',
				params: z.object({ id: z.string() }),
				body: createForumReplySchema,
				response: { 201: forumPostSchema, 400: ErrorSchema },
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		createForumReplyController,
	);

	server.patch(
		'/forum/post/:id/reply/:replyId',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Update a forum reply (author or admin).',
				params: z.object({ id: z.string(), replyId: z.string() }),
				body: updateForumReplySchema,
				response: {
					200: forumPostSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
				},
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateForumReplyController,
	);

	server.delete(
		'/forum/post/:id/reply/:replyId',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Delete a forum reply (author or admin).',
				params: z.object({ id: z.string(), replyId: z.string() }),
				response: { 204: z.null(), 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteForumReplyController,
	);

	server.post(
		'/forum/post/:id/reply/:replyId/accept',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Mark a reply as accepted (post author only).',
				params: z.object({ id: z.string(), replyId: z.string() }),
				response: { 200: forumPostSchema, 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		acceptForumReplyController,
	);

	server.post(
		'/forum/post/:id/reply/:replyId/upvote',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Toggle upvote on a forum reply.',
				params: z.object({ id: z.string(), replyId: z.string() }),
				response: { 200: forumPostSchema, 400: ErrorSchema },
				tags: ['Forum'],
				security: [{ bearerAuth: [] }],
			},
		},
		upvoteForumReplyController,
	);
}
