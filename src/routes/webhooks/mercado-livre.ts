import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleMercadoLivreWebhook } from '../../controllers/webhooks/mercado-livre.js';

export async function mercadoLivreWebhookRoute(server: FastifyInstance) {
	// Raw body buffer — preserva fidelidade do payload ML pro forward ao tenant.
	// Encapsulado: só afeta rotas deste plugin.
	server.addContentTypeParser(
		'application/json',
		{ parseAs: 'buffer' },
		(_req, body, done) => {
			done(null, body);
		},
	);

	server.post(
		'/webhooks/mercado-livre',
		{
			schema: {
				description:
					'Proxy de webhook ML. Recebe eventos da única URL cadastrada no DevCenter, consulta pl_tenant_ml_seller pelo user_id, e forwarda o body pro deploy Vercel do tenant correto.',
				tags: ['Webhook'],
				response: {
					200: z.object({ received: z.literal(true) }),
				},
			},
		},
		handleMercadoLivreWebhook,
	);
}
