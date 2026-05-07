import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, authenticateAdmin } from '@/middleware/auth.js';
import {
	createKnowledgeBaseController,
	deleteKnowledgeBaseController,
	getKnowledgeBaseController,
	listKnowledgeBaseController,
	updateKnowledgeBaseController,
} from '../controllers/knowledge-base.js';
import { ErrorSchema } from '../types/error.js';
import {
	createKnowledgeBaseSchema,
	knowledgeBaseArticleSchema,
	listKnowledgeBaseQuery,
	updateKnowledgeBaseSchema,
} from '../types/knowledge-base.js';

export async function knowledgeBaseRoute(server: FastifyInstance) {
	server.get(
		'/knowledge-base',
		{
			preHandler: [authenticate],
			schema: {
				description: 'List knowledge base articles and videos.',
				querystring: listKnowledgeBaseQuery,
				response: {
					200: z.array(knowledgeBaseArticleSchema),
					500: ErrorSchema,
				},
				tags: ['Knowledge Base'],
				security: [{ bearerAuth: [] }],
			},
		},
		listKnowledgeBaseController,
	);

	server.get(
		'/knowledge-base/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Get a single knowledge base article.',
				params: z.object({ id: z.string() }),
				response: {
					200: knowledgeBaseArticleSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Knowledge Base'],
				security: [{ bearerAuth: [] }],
			},
		},
		getKnowledgeBaseController,
	);

	server.post(
		'/knowledge-base',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Create a knowledge base article (staff only).',
				body: createKnowledgeBaseSchema,
				response: {
					201: knowledgeBaseArticleSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Knowledge Base'],
				security: [{ bearerAuth: [] }],
			},
		},
		createKnowledgeBaseController,
	);

	server.patch(
		'/knowledge-base/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Update a knowledge base article (staff only).',
				params: z.object({ id: z.string() }),
				body: updateKnowledgeBaseSchema,
				response: {
					200: knowledgeBaseArticleSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Knowledge Base'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateKnowledgeBaseController,
	);

	server.delete(
		'/knowledge-base/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Delete a knowledge base article (staff only).',
				params: z.object({ id: z.string() }),
				response: { 204: z.null(), 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Knowledge Base'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteKnowledgeBaseController,
	);
}
