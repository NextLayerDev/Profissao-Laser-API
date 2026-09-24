import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	buildQuoteProfileController,
	listMachineClassesController,
} from '../controllers/quote-profile.js';
import { authenticateCustomer } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';

/**
 * O PERFIL CURTO — as duas rotas que derrubam o paredão de 31 campos.
 *
 * `authenticateCustomer` e mais nada: não cobra, não grava e não lê perfil de
 * ninguém. A leitura da tabela de máquinas passa pelo repositório de coleção,
 * com a visibilidade de sempre.
 */
const bodySchema = z.object({
	tool: z.string().min(1).max(60).optional(),
	maquinas_collection: z.string().min(1).max(40).optional(),
	/** Id da classe (`co2_100`) ou `outra`. */
	maquina_classe: z.string().min(1).max(40).optional(),
	horas_uteis_dia: z.coerce.number().min(0.5).max(24).optional(),
	ganho_mensal: z.coerce.number().min(0).max(1_000_000).optional(),
	markup_pct: z.coerce.number().min(0).max(5000).optional(),
	regime_fiscal: z.string().min(1).max(40).optional(),
	pedido_minimo: z.coerce.number().min(0).max(1_000_000).optional(),
	/** Derivados que o aluno corrigiu, na escala da COLEÇÃO (percentual 0–100). */
	overrides: z
		.record(z.string().max(40), z.union([z.string(), z.number()]))
		.optional(),
});

export async function quoteProfileRoutes(server: FastifyInstance) {
	server.get(
		'/api/quote/machines',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Classes de máquina de referência (cards do passo 1 do perfil de custo) e os regimes fiscais com o imposto de cada um.',
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		listMachineClassesController,
	);

	server.post(
		'/api/quote/profile',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Monta o perfil de custo INTEIRO (os 31 campos da coleção `perfis`) a partir de seis perguntas que o dono da oficina responde de cabeça. Devolve `data` pronto para o POST da coleção e `assumidos` — o que foi derivado, com a origem de cada número em português. Não cobra, não grava e não passa por IA.',
				body: bodySchema,
				response: { 400: ErrorSchema, 401: ErrorSchema },
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		buildQuoteProfileController,
	);
}
