import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createVectorizeHelpController,
	deleteVectorizeHelpController,
	getVectorizeHelpController,
	listActiveVectorizeHelpController,
	listVectorizeHelpController,
	reorderVectorizeHelpController,
	updateVectorizeHelpController,
} from '../controllers/vectorize-help.js';
import { authenticateAdmin, authenticateCustomer } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	createVectorizeHelpSchema,
	reorderVectorizeHelpSchema,
	updateVectorizeHelpSchema,
	vectorizeHelpActiveListSchema,
	vectorizeHelpListSchema,
	vectorizeHelpSchema,
} from '../types/vectorize-help.js';

export async function vectorizeHelpRoute(server: FastifyInstance) {
	// ── GET /vectorize-help/active — customer (rota estática, antes de /:id) ──
	server.get(
		'/vectorize-help/active',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Lista os itens de ajuda ATIVOS da página de vetorização, ordenados por `order`. Endpoint público para o front do aluno. Shape slim (sem `active` nem timestamps).',
				response: {
					200: vectorizeHelpActiveListSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectorize Help'],
				security: [{ bearerAuth: [] }],
			},
		},
		listActiveVectorizeHelpController,
	);

	// ── POST /vectorize-help/reorder — admin (estática, antes de /:id) ───────
	server.post(
		'/vectorize-help/reorder',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Reordena os itens. O índice de cada id no array `ids` vira o novo `order`. Retorna a lista completa já reordenada.',
				body: reorderVectorizeHelpSchema,
				response: {
					200: vectorizeHelpListSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Vectorize Help'],
				security: [{ bearerAuth: [] }],
			},
		},
		reorderVectorizeHelpController,
	);

	// ── GET /vectorize-help — admin ──────────────────────────────────────────
	server.get(
		'/vectorize-help',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Lista TODOS os itens de ajuda (incluindo inativos), ordenados por `order`. Apenas staff.',
				response: {
					200: vectorizeHelpListSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectorize Help'],
				security: [{ bearerAuth: [] }],
			},
		},
		listVectorizeHelpController,
	);

	// ── POST /vectorize-help — admin ─────────────────────────────────────────
	server.post(
		'/vectorize-help',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Cria um novo item de ajuda. Se `order` não for informado, vai pro fim da lista (auto-increment).',
				body: createVectorizeHelpSchema,
				response: {
					201: vectorizeHelpSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Vectorize Help'],
				security: [{ bearerAuth: [] }],
			},
		},
		createVectorizeHelpController,
	);

	// ── GET /vectorize-help/:id — admin ──────────────────────────────────────
	server.get(
		'/vectorize-help/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Detalhe de um item de ajuda por ID.',
				params: z.object({ id: z.string() }),
				response: {
					200: vectorizeHelpSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectorize Help'],
				security: [{ bearerAuth: [] }],
			},
		},
		getVectorizeHelpController,
	);

	// ── PATCH /vectorize-help/:id — admin ────────────────────────────────────
	server.patch(
		'/vectorize-help/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Atualiza um item de ajuda. Todos os campos opcionais.',
				params: z.object({ id: z.string() }),
				body: updateVectorizeHelpSchema,
				response: {
					200: vectorizeHelpSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectorize Help'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateVectorizeHelpController,
	);

	// ── DELETE /vectorize-help/:id — admin ───────────────────────────────────
	server.delete(
		'/vectorize-help/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Remove um item de ajuda.',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectorize Help'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteVectorizeHelpController,
	);
}
