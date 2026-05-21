import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	deletePreviaController,
	generatePreviaController,
	getPreviaHistoryController,
	getPreviaOptionsController,
	getPreviaQuotaController,
	getPreviaUsageStatsController,
	getPreviaUsageUsersController,
	updatePreviaController,
} from '../controllers/previa.js';
import { authenticateAdmin, authenticateCustomer } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	generatePreviaSchema,
	previaHistoryQuerySchema,
	previaHistoryResponseSchema,
	previaOptionsResponseSchema,
	previaQuotaErrorSchema,
	previaQuotaSchema,
	previaSchema,
	previaUsageStatsSchema,
	previaUsageUsersQuerySchema,
	previaUsageUsersResponseSchema,
	updatePreviaSchema,
} from '../types/previa.js';

export async function previaRoute(server: FastifyInstance) {
	server.post(
		'/previas/generate',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Gera uma prévia fotorrealista de gravação a laser via IA (Nano Banana 2 / Gemini 3 Pro Image). Salva a imagem gerada e retorna o registro completo. Limite de 5 gerações por dia por customer (reset 00:00 BRT) — ao bater retorna 429 com payload sugerindo upgrade.',
				body: generatePreviaSchema,
				response: {
					201: previaSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					429: previaQuotaErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Previas'],
				security: [{ bearerAuth: [] }],
			},
		},
		generatePreviaController,
	);

	server.get(
		'/previas/quota',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Retorna o uso diário de prévias do customer logado: limite, usados, restantes e quando reseta. Útil para o front mostrar o contador antes do usuário tentar gerar.',
				response: {
					200: previaQuotaSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Previas'],
				security: [{ bearerAuth: [] }],
			},
		},
		getPreviaQuotaController,
	);

	server.get(
		'/previas/options',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Catálogo completo das opções de laserSettings: 15 campos discretos (tamanho, posicao, intensidade, tipoVisualizacao com 360/render-3d/fotogravacao, anguloCamera, iluminacao, fundoCena, etc.) + 80 fontes (com família CSS e categoria) + ranges dos sliders. Cada opção traz value + label PT-BR. Use para montar os seletores do frontend sem hard-code.',
				response: {
					200: previaOptionsResponseSchema,
					403: ErrorSchema,
				},
				tags: ['Previas'],
				security: [{ bearerAuth: [] }],
			},
		},
		getPreviaOptionsController,
	);

	server.get(
		'/previas/history',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Lista paginada das prévias geradas pelo customer logado.',
				querystring: previaHistoryQuerySchema,
				response: {
					200: previaHistoryResponseSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Previas'],
				security: [{ bearerAuth: [] }],
			},
		},
		getPreviaHistoryController,
	);

	server.put(
		'/previas/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Atualiza metadados (nome, notas) de uma prévia do customer logado.',
				params: z.object({ id: z.string() }),
				body: updatePreviaSchema,
				response: {
					200: previaSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Previas'],
				security: [{ bearerAuth: [] }],
			},
		},
		updatePreviaController,
	);

	// ── Admin: usage stats + users (staff only) ──────────────────────────
	server.get(
		'/previas/usage/stats',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Stats globais de uso da feature de prévias IA (admin). Retorna: prévias geradas hoje (BRT), customers ativos hoje, total de customers que já usaram.',
				response: {
					200: previaUsageStatsSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Previas'],
				security: [{ bearerAuth: [] }],
			},
		},
		getPreviaUsageStatsController,
	);

	server.get(
		'/previas/usage/users',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Lista paginada de customers que geraram prévias, com totalPrevias, todayPrevias e lastGeneratedAt. Suporta busca por nome, email ou customerId. Apenas staff.',
				querystring: previaUsageUsersQuerySchema,
				response: {
					200: previaUsageUsersResponseSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Previas'],
				security: [{ bearerAuth: [] }],
			},
		},
		getPreviaUsageUsersController,
	);

	server.delete(
		'/previas/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Remove a prévia do banco e o arquivo de imagem do CDN.',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Previas'],
				security: [{ bearerAuth: [] }],
			},
		},
		deletePreviaController,
	);
}
