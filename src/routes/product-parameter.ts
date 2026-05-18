import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createProductParameterController,
	deleteProductParameterController,
	listProductParametersController,
	parameterLookupController,
	updateProductParameterController,
} from '../controllers/product-parameter.js';
import { authenticateAdmin, authenticateCustomer } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	createProductParameterSchema,
	parameterLookupQuerySchema,
	parameterLookupResponseSchema,
	productParameterListResponseSchema,
	productParameterSchema,
	updateProductParameterSchema,
} from '../types/product-parameter.js';

export async function productParameterRoute(server: FastifyInstance) {
	// ── GET /laser-products/:id/parameter-lookup — customer (o fluxo) ───────
	// Rota estática declarada antes de /:assocId pra evitar colisão.
	server.get(
		'/laser-products/:id/parameter-lookup',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Retorna o parâmetro de gravação mais específico que casa com o produto + a máquina do cliente, junto da vídeo-aula. Query params (todos opcionais): machineId, powerOptionId, lensOptionId, softwareOptionId, axisOptionId, operationOptionId. Se machineId não vier, usa a máquina salva do customer (/me/machine).',
				params: z.object({ id: z.string() }),
				querystring: parameterLookupQuerySchema,
				response: {
					200: parameterLookupResponseSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Product Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		parameterLookupController,
	);

	// ── GET /laser-products/:id/parameters — admin (lista associações) ──────
	server.get(
		'/laser-products/:id/parameters',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Lista as associações produto↔máquina↔parâmetro do produto, com o parâmetro e a vídeo-aula embedded.',
				params: z.object({ id: z.string() }),
				response: {
					200: productParameterListResponseSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Product Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		listProductParametersController,
	);

	// ── POST /laser-products/:id/parameters — admin ─────────────────────────
	server.post(
		'/laser-products/:id/parameters',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Associa um parâmetro ao produto para uma máquina. Informe `parameterId` (parâmetro existente) OU `parameter` (cria um novo pl_parameter inline). Config opcional (potência/lente/eixo/operação) e `lessonId` (vídeo-aula) opcional.',
				params: z.object({ id: z.string() }),
				body: createProductParameterSchema,
				response: {
					201: productParameterSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Product Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		createProductParameterController,
	);

	// ── PATCH /laser-products/:id/parameters/:assocId — admin ───────────────
	server.patch(
		'/laser-products/:id/parameters/:assocId',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Atualiza uma associação de parâmetro.',
				params: z.object({ id: z.string(), assocId: z.string() }),
				body: updateProductParameterSchema,
				response: {
					200: productParameterSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Product Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateProductParameterController,
	);

	// ── DELETE /laser-products/:id/parameters/:assocId — admin ──────────────
	server.delete(
		'/laser-products/:id/parameters/:assocId',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Remove uma associação de parâmetro do produto.',
				params: z.object({ id: z.string(), assocId: z.string() }),
				response: {
					204: z.null(),
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Product Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteProductParameterController,
	);
}
