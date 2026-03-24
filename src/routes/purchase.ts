import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, authenticateAdmin } from '@/middleware/auth.js';
import {
	createPurchaseController,
	createSubscriptionController,
	downgradeSubscriptionController,
	getAllPurchasesController,
	getPaymentAttemptsController,
	upgradeSubscriptionController,
} from '../controllers/purchase.js';
import { ErrorSchema } from '../types/error.js';

export async function purchaseRoute(server: FastifyInstance) {
	server.post(
		'/purchase',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Create a Stripe checkout session for a product purchase.',
				body: z.object({
					productId: z.uuid(),
					companyName: z.string().optional(),
				}),
				response: {
					201: z.object({
						id: z.string(),
						checkoutUrl: z.string().nullable(),
						status: z.string().nullable(),
						productName: z.string(),
					}),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		createPurchaseController,
	);

	server.post(
		'/subscription',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Create a Stripe subscription for a user by email.',
				body: z.object({
					email: z.email(),
					stripeProductId: z.string(),
					amount: z.number().nonnegative(),
					interval: z.enum(['month', 'year']),
					intervalCount: z.number().int().positive().default(1),
					endsAt: z.string(),
				}),
				response: {
					201: z.object({
						id: z.string(),
						status: z.string(),
						customerId: z.string(),
						email: z.string(),
						amount: z.number(),
						interval: z.string(),
						intervalCount: z.number(),
						endsAt: z.string(),
					}),
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		createSubscriptionController,
	);

	const planChangeResponseSchema = z.object({
		subscriptionId: z.string(),
		status: z.string(),
		previousPlan: z.enum(['prata', 'ouro', 'platina']),
		newPlan: z.enum(['prata', 'ouro', 'platina']),
	});

	const planChangeBodySchema = z.object({ productId: z.uuid() });

	server.post(
		'/subscription/upgrade',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Upgrade the current subscription to a higher plan.',
				body: planChangeBodySchema,
				response: {
					200: planChangeResponseSchema,
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		upgradeSubscriptionController,
	);

	server.post(
		'/subscription/downgrade',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Downgrade the current subscription to a lower plan.',
				body: planChangeBodySchema,
				response: {
					200: planChangeResponseSchema,
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		downgradeSubscriptionController,
	);

	server.get(
		'/sales',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Retrieve all purchases (Administrative view).',
				response: {
					200: z.array(
						z.object({
							id: z.string(),
							date: z.string(),
							amount: z.number(),
							currency: z.string().nullable(),
							status: z.string(),
							product: z.string(),
							customer: z.object({
								name: z.string(),
								email: z.string(),
							}),
							receipt_url: z.string().nullable(),
						}),
					),
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		getAllPurchasesController,
	);

	server.get(
		'/sales/attempts',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'List all Stripe payment attempts including failed ones. Filter by status (succeeded/failed) and paginate with limit/starting_after.',
				querystring: z.object({
					status: z.enum(['succeeded', 'failed', 'all']).optional(),
					limit: z.coerce.number().int().min(1).max(100).optional(),
					starting_after: z.string().optional(),
				}),
				response: {
					200: z.array(
						z.object({
							id: z.string(),
							date: z.string(),
							amount: z.number(),
							currency: z.string(),
							status: z.string(),
							failure_message: z.string().nullable(),
							product: z.string(),
							customer: z.object({
								name: z.string(),
								email: z.string(),
							}),
							receipt_url: z.string().nullable(),
						}),
					),
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		getPaymentAttemptsController,
	);
}
