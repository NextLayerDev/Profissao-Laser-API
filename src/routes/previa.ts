import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	deletePreviaController,
	generatePreviaController,
	getPreviaHistoryController,
	getPreviaQuotaController,
	updatePreviaController,
} from '../controllers/previa.js';
import { authenticateCustomer } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	generatePreviaSchema,
	previaHistoryQuerySchema,
	previaHistoryResponseSchema,
	previaQuotaErrorSchema,
	previaQuotaSchema,
	previaSchema,
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
