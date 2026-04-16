import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleRegisterMLSeller } from '../../controllers/internal/ml-seller.js';
import { ErrorSchema } from '../../types/error.js';

export async function mlSellerRoute(server: FastifyInstance) {
	server.post(
		'/internal/ml-seller/register',
		{
			schema: {
				description:
					'Registra mapping seller_id → tenant_slug pro proxy de webhook ML. Chamado pelos deploys de tenant após OAuth bem-sucedido. Auth via header X-Internal-Secret.',
				tags: ['Internal'],
				body: z.object({
					seller_id: z.string().min(1),
					tenant_slug: z.string().min(1),
					store_id: z.string().min(1),
					company_id: z.string().optional(),
				}),
				response: {
					200: z.object({ ok: z.literal(true) }),
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
			},
		},
		handleRegisterMLSeller,
	);
}
