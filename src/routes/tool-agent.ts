import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toolAgentController } from '../controllers/tool-agent.js';
import { authenticateVectorizacao } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';

const turnBodySchema = z.object({
	session_id: z.string().min(1).max(120),
	definition: z.record(z.string(), z.unknown()).default({}),
	catalog: z
		.object({
			blocks: z.array(z.record(z.string(), z.unknown())).default([]),
			custom_nodes: z.array(z.record(z.string(), z.unknown())).optional(),
			inputs: z.array(z.record(z.string(), z.unknown())).optional(),
		})
		.passthrough(),
	message: z.string().min(1).max(8000),
	history: z
		.array(
			z.object({
				role: z.enum(['user', 'assistant']),
				content: z.string(),
			}),
		)
		.default([]),
});

export async function toolAgentRoute(server: FastifyInstance) {
	server.post(
		'/api/tool-agent/turn',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: [
					'Um turno do Agente "Tool Engineer" (Claude tool-use), em **SSE**.',
					'O front manda `{session_id, definition, catalog, message, history}`;',
					'o agente monta a ToolDefinition conversando e devolve eventos ao vivo:',
					'`text` (narração), `action` (cada ação), `doc` (definition nova →',
					'canvas/prévia atualizam), `cost` (voxes/saldo), `done`. NUNCA publica.',
					'Cobrança por tokens→voxes (com markup) ao fim do turno.',
				].join('\n'),
				body: turnBodySchema,
				response: {
					402: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		toolAgentController,
	);
}
