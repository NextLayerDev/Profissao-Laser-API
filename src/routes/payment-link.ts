import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireModule } from '@/middleware/auth.js';
import {
	createPaymentLinkController,
	getPaymentLinkInfoController,
	listPaymentLinksController,
	redeemPaymentLinkController,
} from '../controllers/payment-link.js';
import { ErrorSchema } from '../types/error.js';
import {
	createPaymentLinkResponseSchema,
	createPaymentLinkSchema,
	paymentLinkInfoResponseSchema,
	paymentLinkListItemSchema,
	paymentLinkTokenParamsSchema,
	redeemPaymentLinkResponseSchema,
	redeemPaymentLinkSchema,
} from '../types/payment-link.js';

export async function paymentLinkRoute(server: FastifyInstance) {
	server.get(
		'/payment-links',
		{
			preHandler: [requireModule('links')],
			schema: {
				description:
					'List all payment links with product names, status, and customer info.',
				response: {
					200: z.array(paymentLinkListItemSchema),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Payment Links'],
				security: [{ bearerAuth: [] }],
			},
		},
		listPaymentLinksController,
	);

	server.post(
		'/payment-link',
		{
			preHandler: [requireModule('links')],
			schema: {
				description:
					'Create a single-use payment link with 99% discount for a product without system class.',
				body: createPaymentLinkSchema,
				response: {
					201: createPaymentLinkResponseSchema,
					400: ErrorSchema,
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Payment Links'],
				security: [{ bearerAuth: [] }],
			},
		},
		createPaymentLinkController,
	);

	server.get(
		'/payment-link/:token',
		{
			schema: {
				description:
					'Get payment link details including product info and discounted price.',
				params: paymentLinkTokenParamsSchema,
				response: {
					200: paymentLinkInfoResponseSchema,
					404: ErrorSchema,
					410: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Payment Links'],
			},
		},
		getPaymentLinkInfoController,
	);

	server.post(
		'/payment-link/:token/redeem',
		{
			schema: {
				description:
					'Verify customer identity and create Stripe checkout session with 99% discount.',
				params: paymentLinkTokenParamsSchema,
				body: redeemPaymentLinkSchema,
				response: {
					201: redeemPaymentLinkResponseSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					410: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Payment Links'],
			},
		},
		redeemPaymentLinkController,
	);
}
