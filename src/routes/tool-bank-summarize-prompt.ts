import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { summarizePromptController } from '../controllers/tool-bank-summarize-prompt.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';

const bodySchema = z.object({
	prompt_script: z.string().min(1),
	mode: z.string().optional(),
	target_chars: z.number().int().positive().optional(),
});

const responseSchema = z.object({
	result: z.string(),
	unchanged: z.boolean().optional(),
	shortened: z.boolean().optional(),
	fallback: z.boolean().optional(),
	error: z.string().optional(),
});

/**
 * "Resumir prompt": a IA encurta o `prompt_script` do admin preservando todo
 * `{placeholder}` (admin-only). Espelha `tool-bank-smart-tema.ts` — a análise
 * não depende da tool, por isso a rota é não-keyed.
 */
export async function toolBankSummarizePromptRoute(server: FastifyInstance) {
	server.post(
		'/api/tools/summarize-prompt',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Encurta o prompt_script preservando todo {placeholder} (admin).',
				body: bodySchema,
				response: {
					200: responseSchema,
					400: ErrorSchema,
				},
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		summarizePromptController,
	);
}
