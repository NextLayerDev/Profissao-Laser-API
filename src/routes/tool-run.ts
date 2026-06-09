import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toolRunController } from '../controllers/tool-run.js';
import { authenticateVectorizacao } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import { toolRunResultSchema } from '../types/tool-run.js';

export async function toolRunRoute(server: FastifyInstance) {
	server.post(
		'/api/tool-run/:key',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: [
					'Motor genérico da Fábrica de Tools: roda qualquer ToolDefinition',
					'(`blocks_v1`) publicada no upvox, por `key`. Espelha o billing do',
					'`/api/laser-prep` (invoke→settle/refund no upvox).',
					'',
					'Envio via **multipart/form-data**: o arquivo (quando a tool tem input',
					'de imagem) + um campo por input declarado na definition +',
					'`invocation_id` (opcional, id da invocação cobrada pelo upvox).',
					'',
					'Staff pode enviar `definition` (JSON inline) pra **preview de rascunho**',
					'— nesse modo não cobra.',
					'',
					'Resposta: `{ id, output }`, onde `output` é a projeção de',
					'`definition.output` (forma varia por tool).',
				].join('\n'),
				consumes: ['multipart/form-data'],
				params: z.object({ key: z.string().min(1).max(60) }),
				response: {
					201: toolRunResultSchema,
					400: ErrorSchema,
					402: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
					502: ErrorSchema,
				},
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		toolRunController,
	);
}
