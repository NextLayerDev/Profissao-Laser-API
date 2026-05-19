import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	adjustController,
	createCheckoutController,
	createPackageController,
	getBalanceController,
	historyController,
	listAllPackagesController,
	listCostsController,
	listPackagesController,
	updateCostController,
	updatePackageController,
	updatePackageStatusController,
} from '../controllers/credit.js';
import { authenticateAdmin, authenticateCustomer } from '../middleware/auth.js';
import {
	adjustCreditsSchema,
	checkoutResponseSchema,
	createCheckoutSchema,
	createPackageSchema,
	creditBalanceSchema,
	creditCostListSchema,
	creditHistoryQuerySchema,
	creditHistoryResponseSchema,
	creditPackageListSchema,
	creditPackageSchema,
	updateCostSchema,
	updatePackageSchema,
	updatePackageStatusSchema,
} from '../types/credit.js';
import { ErrorSchema } from '../types/error.js';

export async function creditRoute(server: FastifyInstance) {
	server.get(
		'/credits/balance',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Saldo de créditos do customer logado.',
				response: { 200: creditBalanceSchema, 403: ErrorSchema },
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		getBalanceController,
	);

	server.get(
		'/credits/costs',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Custo em créditos por feature.',
				response: { 200: creditCostListSchema, 403: ErrorSchema },
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		listCostsController,
	);

	server.get(
		'/credits/packages',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Pacotes de crédito ativos para compra.',
				response: { 200: creditPackageListSchema, 403: ErrorSchema },
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		listPackagesController,
	);

	server.post(
		'/credits/checkout',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Cria uma sessão Stripe Checkout para comprar um pacote.',
				body: createCheckoutSchema,
				response: {
					200: checkoutResponseSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		createCheckoutController,
	);

	server.get(
		'/credits/history',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Histórico (livro-razão) de créditos do customer.',
				querystring: creditHistoryQuerySchema,
				response: {
					200: creditHistoryResponseSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		historyController,
	);

	// ── Admin ───────────────────────────────────────────────────────────
	server.get(
		'/credits/packages/all',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Lista todos os pacotes (inclui inativos).',
				response: { 200: creditPackageListSchema, 403: ErrorSchema },
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		listAllPackagesController,
	);

	server.post(
		'/credits/packages',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Cria um pacote (Stripe product+price) e grava no banco.',
				body: createPackageSchema,
				response: {
					201: creditPackageSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		createPackageController,
	);

	server.put(
		'/credits/packages/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Edita um pacote de crédito.',
				params: z.object({ id: z.string() }),
				body: updatePackageSchema,
				response: {
					200: creditPackageSchema,
					403: ErrorSchema,
					404: ErrorSchema,
				},
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		updatePackageController,
	);

	server.patch(
		'/credits/packages/:id/status',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Ativa/desativa um pacote.',
				params: z.object({ id: z.string() }),
				body: updatePackageStatusSchema,
				response: {
					200: creditPackageSchema,
					403: ErrorSchema,
					404: ErrorSchema,
				},
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		updatePackageStatusController,
	);

	server.put(
		'/credits/costs/:feature',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Ajusta o custo em créditos de uma feature.',
				params: z.object({ feature: z.string() }),
				body: updateCostSchema,
				response: {
					200: z.object({ feature: z.string(), cost: z.number() }),
					403: ErrorSchema,
				},
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateCostController,
	);

	server.post(
		'/credits/adjust',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Ajuste manual de saldo (estorno/cortesia/correção).',
				body: adjustCreditsSchema,
				response: {
					200: creditBalanceSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Credits'],
				security: [{ bearerAuth: [] }],
			},
		},
		adjustController,
	);
}
