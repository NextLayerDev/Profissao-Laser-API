import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { smartTemaController } from '../controllers/tool-bank-smart-tema.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';

const bodySchema = z.object({
	prompt_script: z.string().min(1),
	mode: z.string().optional(),
});

const responseSchema = z.object({
	result: z.string(),
	already: z.boolean().optional(),
	not_needed: z.boolean().optional(),
	fallback: z.boolean().optional(),
	error: z.string().optional(),
});

/**
 * "Add tema inteligente": a IA lê o `prompt_script` do admin e insere o
 * marcador `{tema}` no lugar ideal (admin-only). A análise não depende da tool,
 * por isso a rota é não-keyed.
 */
export async function toolBankSmartTemaRoute(server: FastifyInstance) {
	server.post(
		'/api/tools/smart-tema',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Analisa o prompt_script e insere o marcador {tema} no lugar ideal (admin).',
				body: bodySchema,
				response: {
					200: responseSchema,
					400: ErrorSchema,
				},
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		smartTemaController,
	);
}
