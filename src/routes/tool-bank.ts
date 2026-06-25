import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createToolBankController,
	deleteToolBankController,
	listToolBankController,
	reorderToolBankController,
	updateToolBankController,
	uploadToolBankImageController,
} from '../controllers/tool-bank.js';
import { authenticateAdmin, authenticateCustomer } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	reorderToolBankSchema,
	toolBankEntrySchema,
} from '../types/tool-bank.js';

const keyParams = z.object({ key: z.string().min(1).max(60) });
const keyIdParams = z.object({
	key: z.string().min(1).max(60),
	id: z.string(),
});

/**
 * Banco do Admin de uma tool (Fábrica de Tools). Admin alimenta os registros;
 * o cliente lista os ativos pra galeria. Os registros são injetados no pipeline
 * pelo motor (ToolDefinition.bank.inject) no `/api/tool-run/:key`.
 */
export async function toolBankRoute(server: FastifyInstance) {
	server.get(
		'/api/tools/:key/bank',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Lista os registros do banco de uma tool (cliente: só ativos; staff: todos). Filtro opcional por categoria.',
				params: keyParams,
				querystring: z.object({ category: z.string().optional() }),
				response: { 200: z.array(toolBankEntrySchema), 500: ErrorSchema },
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		listToolBankController,
	);

	server.post(
		'/api/tools/:key/bank',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Cria um registro no banco (admin, multipart/form-data: title, description, category, position, active, data[JSON] + arquivos example_before/example_after).',
				consumes: ['multipart/form-data'],
				params: keyParams,
				response: {
					201: toolBankEntrySchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		createToolBankController,
	);

	server.post(
		'/api/tools/:key/bank/reorder',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Reordena registros do banco (admin).',
				params: keyParams,
				body: reorderToolBankSchema,
				response: { 204: z.null(), 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		reorderToolBankController,
	);

	server.post(
		'/api/tools/:key/bank/upload-image',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Upload de imagem de exemplo (admin, multipart/form-data).',
				consumes: ['multipart/form-data'],
				params: keyParams,
				response: {
					200: z.object({ url: z.string() }),
					400: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadToolBankImageController,
	);

	server.patch(
		'/api/tools/:key/bank/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Atualiza um registro do banco (admin, multipart/form-data; removeExampleBefore/After=true limpa o exemplo).',
				consumes: ['multipart/form-data'],
				params: keyIdParams,
				response: {
					200: toolBankEntrySchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateToolBankController,
	);

	server.delete(
		'/api/tools/:key/bank/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Exclui um registro do banco (admin).',
				params: keyIdParams,
				response: { 204: z.null(), 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteToolBankController,
	);
}
