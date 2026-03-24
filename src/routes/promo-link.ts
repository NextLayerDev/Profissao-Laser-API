import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateAdmin } from '@/middleware/auth.js';
import {
	createPromoLinkController,
	getPromoLinkInfoController,
	listPromoLinksController,
	redeemPromoLinkController,
	updatePromoLinkStatusController,
} from '../controllers/promo-link.js';
import { ErrorSchema } from '../types/error.js';
import {
	createPromoLinkResponseSchema,
	createPromoLinkSchema,
	promoLinkIdParamsSchema,
	promoLinkInfoResponseSchema,
	promoLinkListItemSchema,
	promoLinkTokenParamsSchema,
	redeemPromoLinkResponseSchema,
	redeemPromoLinkSchema,
	updatePromoLinkStatusResponseSchema,
	updatePromoLinkStatusSchema,
} from '../types/promo-link.js';

export async function promoLinkRoute(server: FastifyInstance) {
	server.post(
		'/promo-link',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Create a promotional link with configurable discount, max redemptions, and duration.',
				body: createPromoLinkSchema,
				response: {
					201: createPromoLinkResponseSchema,
					400: ErrorSchema,
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Promo Links'],
				security: [{ bearerAuth: [] }],
			},
		},
		createPromoLinkController,
	);

	server.get(
		'/promo-link/:token',
		{
			schema: {
				description:
					'Get promotional link details including product info, discount, and remaining redemptions.',
				params: promoLinkTokenParamsSchema,
				response: {
					200: promoLinkInfoResponseSchema,
					404: ErrorSchema,
					410: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Promo Links'],
			},
		},
		getPromoLinkInfoController,
	);

	server.post(
		'/promo-link/:token/redeem',
		{
			schema: {
				description:
					'Redeem a promotional link: register account and create Stripe checkout session with discount applied. One use per CPF+phone.',
				params: promoLinkTokenParamsSchema,
				body: redeemPromoLinkSchema,
				response: {
					201: redeemPromoLinkResponseSchema,
					400: ErrorSchema,
					404: ErrorSchema,
					409: ErrorSchema,
					410: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Promo Links'],
			},
		},
		redeemPromoLinkController,
	);

	server.patch(
		'/promo-link/:id/status',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Manually activate or deactivate a promotional link.',
				params: promoLinkIdParamsSchema,
				body: updatePromoLinkStatusSchema,
				response: {
					200: updatePromoLinkStatusResponseSchema,
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Promo Links'],
				security: [{ bearerAuth: [] }],
			},
		},
		updatePromoLinkStatusController,
	);

	server.get(
		'/promo-links',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'List all promotional links with redemption counts, status, and product info.',
				response: {
					200: z.array(promoLinkListItemSchema),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Promo Links'],
				security: [{ bearerAuth: [] }],
			},
		},
		listPromoLinksController,
	);
}
