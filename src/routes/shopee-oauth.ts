import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleShopeeCallback } from '../controllers/shopee-oauth.js';
import { ErrorSchema } from '../types/error.js';

export async function shopeeOAuthRoute(server: FastifyInstance) {
	server.get(
		'/oauth/shopee/callback',
		{
			schema: {
				description:
					'Proxy OAuth da Shopee. Decodifica o state, consulta pl_tenant e redireciona 302 pro deploy da empresa correta (multi-tenant).',
				tags: ['OAuth'],
				querystring: z.object({
					code: z.string().optional(),
					shop_id: z.string().optional(),
					state: z.string(),
					error: z.string().optional(),
					message: z.string().optional(),
				}),
				response: {
					302: z.null().describe('Redirect pro deploy do tenant'),
					400: ErrorSchema,
					404: ErrorSchema,
				},
			},
		},
		handleShopeeCallback,
	);
}
