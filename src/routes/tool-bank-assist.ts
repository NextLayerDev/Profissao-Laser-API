import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { promptAssistController } from '../controllers/tool-bank-assist.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';

const bodySchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('card'),
		idea: z.string().trim().min(3).max(600),
		formats: z
			.array(z.object({ id: z.string().max(80), label: z.string().max(80) }))
			.max(40)
			.optional(),
		categories: z.array(z.string().max(60)).max(60).optional(),
	}),
	z.object({
		kind: z.literal('phone'),
		name: z.string().trim().min(2).max(80),
	}),
	z.object({
		kind: z.literal('popular'),
		existing: z.array(z.string().max(80)).max(200).optional(),
	}),
]);

/**
 * "Preencher com IA" do Estúdio de Prompts (admin). Não depende da tool —
 * mesma linha de `/api/tools/smart-tema`.
 */
export async function toolBankAssistRoute(server: FastifyInstance) {
	server.post(
		'/api/tools/prompt-assist',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Sugere um card a partir de uma ideia, as medidas de um celular pelo nome ou os mais vendidos que faltam (admin).',
				body: bodySchema,
				response: { 400: ErrorSchema },
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		promptAssistController,
	);
}
