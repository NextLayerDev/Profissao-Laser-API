import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleMercadoLivreCallback } from '../controllers/mercado-livre-oauth.js';
import { ErrorSchema } from '../types/error.js';

export async function mercadoLivreOAuthRoute(server: FastifyInstance) {
	server.get(
		'/oauth/mercado-livre/callback',
		{
			schema: {
				description:
					'Proxy OAuth do Mercado Livre. Decodifica o state, consulta pl_tenant e redireciona 302 pro deploy da empresa correta (multi-tenant).',
				tags: ['OAuth'],
				querystring: z.object({
					code: z.string().optional(),
					state: z.string(),
					error: z.string().optional(),
					error_description: z.string().optional(),
				}),
				response: {
					302: z.null().describe('Redirect pro deploy do tenant'),
					400: ErrorSchema,
					404: ErrorSchema,
				},
			},
		},
		handleMercadoLivreCallback,
	);
}
