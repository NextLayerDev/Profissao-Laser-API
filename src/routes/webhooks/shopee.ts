import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleShopeeWebhook } from '../../controllers/webhooks/shopee.js';

export async function shopeeWebhookRoute(server: FastifyInstance) {
	// Raw body buffer — preserva fidelidade do payload Shopee pro forward ao
	// tenant E pra recomputar a signature HMAC sobre o body original.
	server.addContentTypeParser(
		'application/json',
		{ parseAs: 'buffer' },
		(_req, body, done) => {
			done(null, body);
		},
	);

	server.post(
		'/webhooks/shopee',
		{
			schema: {
				description:
					'Proxy de webhook Shopee. Recebe pushes da única URL cadastrada no painel Open Platform, valida a signature HMAC com SHOPEE_PARTNER_KEY, consulta pl_tenant_shopee_shop pelo shop_id, e forwarda o body pro deploy Vercel do tenant correto (com X-Internal-Secret + X-Shopee-Verified).',
				tags: ['Webhook'],
				response: {
					200: z.object({ received: z.literal(true) }),
				},
			},
		},
		handleShopeeWebhook,
	);
}
