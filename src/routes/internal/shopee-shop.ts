import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleRegisterShopeeShop } from '../../controllers/internal/shopee-shop.js';
import { ErrorSchema } from '../../types/error.js';

export async function shopeeShopRoute(server: FastifyInstance) {
	server.post(
		'/internal/shopee-shop/register',
		{
			schema: {
				description:
					'Registra mapping shop_id → tenant_slug pro proxy de webhook Shopee. Chamado pelos deploys de tenant após OAuth bem-sucedido. Auth via header X-Internal-Secret.',
				tags: ['Internal'],
				body: z.object({
					shop_id: z.string().min(1),
					tenant_slug: z.string().min(1),
					store_id: z.string().min(1),
					company_id: z.string().optional(),
					region: z.string().optional(),
				}),
				response: {
					200: z.object({ ok: z.literal(true) }),
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
			},
		},
		handleRegisterShopeeShop,
	);
}
