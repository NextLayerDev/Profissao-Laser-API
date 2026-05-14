import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	authenticate,
	authenticateAdmin,
	authenticateCustomer,
} from '@/middleware/auth.js';
import {
	addAddonController,
	adminChangePlanController,
	createPurchaseController,
	createRefundController,
	createSubscriptionController,
	downgradeSubscriptionController,
	getAllPurchasesController,
	getPaymentAttemptsController,
	getRecurringSubscriptionsController,
	getRefundsController,
	listAddonsController,
	removeAddonController,
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
					phone: z.string().optional(),
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
			preHandler: [authenticateCustomer],
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
			preHandler: [authenticateCustomer],
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

	const addonSchema = z.object({
		itemId: z.string(),
		productId: z.string(),
		productName: z.string(),
		stripePriceId: z.string(),
		quantity: z.number().optional(),
	});

	server.post(
		'/subscription/addon',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Add an addon (extra item) to the current subscription.',
				body: z.object({ productId: z.uuid() }),
				response: {
					201: addonSchema.extend({ subscriptionId: z.string() }),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		addAddonController,
	);

	server.delete(
		'/subscription/addon/:itemId',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Remove an addon item from the current subscription.',
				params: z.object({ itemId: z.string() }),
				response: {
					200: z.object({ removed: z.boolean(), itemId: z.string() }),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		removeAddonController,
	);

	server.get(
		'/subscription/addons',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'List addon items attached to the current subscription.',
				response: {
					200: z.array(addonSchema),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		listAddonsController,
	);

	server.patch(
		'/customer/:id/subscription',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Downgrade the subscription plan of a customer (Admin). Renewal date is preserved.',
				params: z.object({ id: z.string() }),
				body: planChangeBodySchema,
				response: {
					200: planChangeResponseSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		adminChangePlanController,
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
							subscriptionMonth: z.number(),
							product: z.string(),
							customer: z.object({
								name: z.string(),
								email: z.string(),
								phone: z.string().nullable(),
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
		'/sales/recurring',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'List all active recurring subscriptions with next charge date. Filter by status (active/trialing/all) and paginate with limit/starting_after.',
				querystring: z.object({
					status: z.enum(['active', 'trialing', 'all']).optional(),
					limit: z.coerce.number().int().min(1).max(100).optional(),
					starting_after: z.string().optional(),
				}),
				response: {
					200: z.array(
						z.object({
							id: z.string(),
							status: z.string(),
							customer: z.object({
								name: z.string(),
								email: z.string(),
								phone: z.string().nullable(),
							}),
							product: z.string(),
							amount: z.number(),
							currency: z.string(),
							interval: z.string().nullable(),
							intervalCount: z.number().nullable(),
							nextChargeAt: z.string().nullable(),
							cancelAtPeriodEnd: z.boolean(),
						}),
					),
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		getRecurringSubscriptionsController,
	);

	server.post(
		'/refund',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Create a full refund for a charge (Admin).',
				body: z.object({
					chargeId: z.string(),
					email: z.email(),
				}),
				response: {
					201: z.object({
						id: z.string(),
						chargeId: z.string(),
						amount: z.number(),
						currency: z.string(),
						status: z.string(),
						reason: z.string().nullable(),
					}),
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		createRefundController,
	);

	server.get(
		'/sales/refunds',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'List all Stripe refunds.',
				querystring: z.object({
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
							reason: z.string().nullable(),
							charge_id: z.string().nullable(),
							customer: z.object({
								name: z.string(),
								email: z.string(),
								phone: z.string().nullable(),
							}),
						}),
					),
					500: ErrorSchema,
				},
				tags: ['Purchases'],
				security: [{ bearerAuth: [] }],
			},
		},
		getRefundsController,
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
								phone: z.string().nullable(),
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
