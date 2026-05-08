import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	cloneTemplateController,
	createTemplateController,
	deleteTemplateController,
	getTemplateController,
	listTemplatesController,
	updateTemplateController,
	uploadTemplateImageController,
} from '../controllers/template.js';
import { authenticateAdmin, authenticateCustomer } from '../middleware/auth.js';
import { designSchema } from '../types/design.js';
import { ErrorSchema } from '../types/error.js';
import {
	cloneTemplateSchema,
	createTemplateSchema,
	templateListQuerySchema,
	templateListResponseSchema,
	templateSchema,
	updateTemplateSchema,
} from '../types/template.js';

export async function templateRoute(server: FastifyInstance) {
	// ── List (autenticado: customer ou staff) ──────────────────────────────
	server.get(
		'/templates',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Lista templates do catálogo. Filtros: categoryId, tipoImagem, tag, search. Customers só veem ativos; staff vê todos.',
				querystring: templateListQuerySchema,
				response: {
					200: templateListResponseSchema,
					500: ErrorSchema,
				},
				tags: ['Templates'],
				security: [{ bearerAuth: [] }],
			},
		},
		listTemplatesController,
	);

	// ── Get one ────────────────────────────────────────────────────────────
	server.get(
		'/templates/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Detalhe de um template.',
				params: z.object({ id: z.string() }),
				response: {
					200: templateSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Templates'],
				security: [{ bearerAuth: [] }],
			},
		},
		getTemplateController,
	);

	// ── Create (admin) ─────────────────────────────────────────────────────
	server.post(
		'/templates',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Cria novo template (apenas staff).',
				body: createTemplateSchema,
				response: {
					201: templateSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Templates'],
				security: [{ bearerAuth: [] }],
			},
		},
		createTemplateController,
	);

	// ── Update (admin) ─────────────────────────────────────────────────────
	server.patch(
		'/templates/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Atualiza template (apenas staff).',
				params: z.object({ id: z.string() }),
				body: updateTemplateSchema,
				response: {
					200: templateSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Templates'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateTemplateController,
	);

	// ── Upload image (admin, multipart) ───────────────────────────────────
	server.post(
		'/templates/:id/image',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: [
					'Upload da imagem do template via **multipart/form-data**.',
					'',
					'| Field | Type | Required | Description |',
					'|-------|------|:--------:|-------------|',
					'| `file` | **binary** | ✓ | Imagem PNG/JPG do template |',
				].join('\n'),
				params: z.object({ id: z.string() }),
				consumes: ['multipart/form-data'],
				response: {
					200: templateSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Templates'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadTemplateImageController,
	);

	// ── Delete (admin) ─────────────────────────────────────────────────────
	server.delete(
		'/templates/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Remove template e arquivo de imagem associado.',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Templates'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteTemplateController,
	);

	// ── Clone (customer) → cria pl_design ─────────────────────────────────
	server.post(
		'/templates/:id/clone',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Clona um template em um novo design pessoal do customer (registro em pl_design). Retorna o design recém-criado.',
				params: z.object({ id: z.string() }),
				body: cloneTemplateSchema,
				response: {
					201: designSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Templates'],
				security: [{ bearerAuth: [] }],
			},
		},
		cloneTemplateController,
	);
}
