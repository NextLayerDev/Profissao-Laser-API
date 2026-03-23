import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.js';
import {
	createGlobalPromoLinkController,
	getGlobalPromoLinkInfoController,
	listGlobalPromoLinksController,
	redeemGlobalPromoLinkController,
	updateGlobalPromoLinkStatusController,
} from '../controllers/global-promo-link.js';
import { ErrorSchema } from '../types/error.js';
import {
	createGlobalPromoLinkResponseSchema,
	createGlobalPromoLinkSchema,
	globalPromoLinkIdParamsSchema,
	globalPromoLinkInfoResponseSchema,
	globalPromoLinkListItemSchema,
	globalPromoLinkTokenParamsSchema,
	redeemGlobalPromoLinkResponseSchema,
	redeemGlobalPromoLinkSchema,
	updateGlobalPromoLinkStatusResponseSchema,
	updateGlobalPromoLinkStatusSchema,
} from '../types/global-promo-link.js';

export async function globalPromoLinkRoute(server: FastifyInstance) {
	server.post(
		'/global-promo-link',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Create a global promotional link with configurable discount, max redemptions, and duration. The customer chooses which product to purchase.',
				body: createGlobalPromoLinkSchema,
				response: {
					201: createGlobalPromoLinkResponseSchema,
					400: ErrorSchema,
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Global Promo Links'],
				security: [{ bearerAuth: [] }],
			},
		},
		createGlobalPromoLinkController,
	);

	server.get(
		'/global-promo-link/:token',
		{
			schema: {
				description:
					'Get global promotional link details including available products with original and discounted prices.',
				params: globalPromoLinkTokenParamsSchema,
				response: {
					200: globalPromoLinkInfoResponseSchema,
					404: ErrorSchema,
					410: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Global Promo Links'],
			},
		},
		getGlobalPromoLinkInfoController,
	);

	server.post(
		'/global-promo-link/:token/redeem',
		{
			schema: {
				description:
					'Redeem a global promotional link: choose a product, register account, and create Stripe checkout session with discount applied. One use per CPF+phone.',
				params: globalPromoLinkTokenParamsSchema,
				body: redeemGlobalPromoLinkSchema,
				response: {
					201: redeemGlobalPromoLinkResponseSchema,
					400: ErrorSchema,
					404: ErrorSchema,
					409: ErrorSchema,
					410: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Global Promo Links'],
			},
		},
		redeemGlobalPromoLinkController,
	);

	server.patch(
		'/global-promo-link/:id/status',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Manually activate or deactivate a global promotional link.',
				params: globalPromoLinkIdParamsSchema,
				body: updateGlobalPromoLinkStatusSchema,
				response: {
					200: updateGlobalPromoLinkStatusResponseSchema,
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Global Promo Links'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateGlobalPromoLinkStatusController,
	);

	server.get(
		'/global-promo-links',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'List all global promotional links with redemption counts and status.',
				response: {
					200: z.array(globalPromoLinkListItemSchema),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Global Promo Links'],
				security: [{ bearerAuth: [] }],
			},
		},
		listGlobalPromoLinksController,
	);
}
