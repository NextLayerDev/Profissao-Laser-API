import type { FastifyInstance } from 'fastify';
import { authenticate } from '@/middleware/auth.js';
import {
	createPaymentLinkController,
	getPaymentLinkInfoController,
	redeemPaymentLinkController,
} from '../controllers/payment-link.js';
import { ErrorSchema } from '../types/error.js';
import {
	createPaymentLinkResponseSchema,
	createPaymentLinkSchema,
	paymentLinkInfoResponseSchema,
	paymentLinkTokenParamsSchema,
	redeemPaymentLinkResponseSchema,
	redeemPaymentLinkSchema,
} from '../types/payment-link.js';

export async function paymentLinkRoute(server: FastifyInstance) {
	server.post(
		'/payment-link',
		{
			preHandler: [authenticate],
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
