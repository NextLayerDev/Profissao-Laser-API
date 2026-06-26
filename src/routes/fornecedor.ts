import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createFornecedorController,
	deleteFornecedorController,
	listFornecedoresController,
	updateFornecedorController,
} from '../controllers/fornecedor.js';
import {
	authenticateAdmin,
	authenticateCommunity,
} from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	createFornecedorSchema,
	fornecedorSchema,
	updateFornecedorSchema,
} from '../types/fornecedor.js';

export async function fornecedorRoute(server: FastifyInstance) {
	// Listagem: gateada por assinatura ativa (mesma regra da gambiarra antiga, que
	// lia o canal da comunidade) — authenticateCommunity exige plano ativo/trial/
	// conta-teste ou staff. A tela do aluno filtra os ativos.
	server.get(
		'/fornecedores',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Lista os fornecedores indicados (tool Fornecedores).',
				response: { 200: z.array(fornecedorSchema), 500: ErrorSchema },
				tags: ['Fornecedores'],
				security: [{ bearerAuth: [] }],
			},
		},
		listFornecedoresController,
	);

	// Gestão (criar/editar/excluir): staff/admin only.
	server.post(
		'/fornecedores',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Cria um fornecedor. Staff only.',
				body: createFornecedorSchema,
				response: { 201: fornecedorSchema, 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Fornecedores'],
				security: [{ bearerAuth: [] }],
			},
		},
		createFornecedorController,
	);

	server.patch(
		'/fornecedores/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Atualiza um fornecedor. Staff only.',
				params: z.object({ id: z.string() }),
				body: updateFornecedorSchema,
				response: {
					200: fornecedorSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
				},
				tags: ['Fornecedores'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateFornecedorController,
	);

	server.delete(
		'/fornecedores/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Remove um fornecedor. Staff only.',
				params: z.object({ id: z.string() }),
				response: { 204: z.null(), 403: ErrorSchema, 500: ErrorSchema },
				tags: ['Fornecedores'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteFornecedorController,
	);
}
