import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toolAgentController } from '../controllers/tool-agent.js';
import { authenticateVectorizacao } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';

// Tetos contra abuso: o catálogo, a definition e o histórico são serializados no
// prompt a CADA iteração (até 16) — sem tetos, um cliente (ou uma conta de teste
// ilimitada, que não debita voxes) infla nosso custo de tokens na Anthropic.
const turnBodySchema = z.object({
	session_id: z.string().min(1).max(120),
	definition: z.record(z.string(), z.unknown()).default({}),
	catalog: z
		.object({
			blocks: z.array(z.record(z.string(), z.unknown())).max(64).default([]),
			custom_nodes: z
				.array(z.record(z.string(), z.unknown()))
				.max(64)
				.optional(),
			inputs: z.array(z.record(z.string(), z.unknown())).max(64).optional(),
		})
		.passthrough(),
	message: z.string().min(1).max(8000),
	history: z
		.array(
			z.object({
				role: z.enum(['user', 'assistant']),
				content: z.string().max(16000),
			}),
		)
		.max(40)
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
