import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toVectorController } from '../controllers/image-gallery.js';
import { enhancePromptController } from '../controllers/image-studio.js';
import { authenticateVectorizacao } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';

/**
 * ESTÚDIO DE IMAGENS — as duas rotas que não cabem no motor genérico.
 *
 * `authenticateVectorizacao` (= `authenticateToolCustomer`) nas duas: é o mesmo
 * middleware do resto da vetorização, e a ponte cobra justamente a tool
 * `vectorize`. Quem não tem acesso à vetorização não deve conseguir criar um
 * vetor por um caminho lateral.
 */
export async function imageStudioRoute(server: FastifyInstance) {
	server.post(
		'/api/image-gallery/:id/to-vector',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: [
					'Manda uma imagem da GALERIA do Estúdio direto para a Vetorização,',
					'sem passar pelo browser: o servidor lê o registro, confere o dono,',
					'baixa o PNG do storage e entra no caminho pago da vetorização',
					'(mesmo billing do line-art com IA — os 3 formatos já saem pagos).',
					'Imagem gerada no modo `vetorizavel` PULA o redesenho por IA: ela já',
					'é binária, então vai direto ao Potrace.',
				].join(' '),
				params: z.object({ id: z.string().min(1).max(64) }),
				body: z
					.object({
						invocation_id: z.string().max(64).optional(),
						tool_key: z.string().min(1).max(60).optional(),
						collection: z.string().min(1).max(40).optional(),
					})
					.optional(),
				response: {
					201: z.object({
						vectorId: z.string(),
						paidFormats: z.array(z.string()),
						vectorReady: z.boolean(),
					}),
					400: ErrorSchema,
					402: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		toVectorController,
	);

	server.post(
		'/api/image-studio/enhance',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: [
					'Reescreve o prompt do aluno (1 turno de `ai.text`, modelo escolhido',
					'pelo admin na Fábrica) e devolve 3 variações curtas. GRÁTIS, com teto',
					'de 30/h por cliente. FAIL-OPEN: qualquer falha devolve o prompt',
					'original intacto — nunca 5xx. No modo `vetorizavel`, gradiente/sombra/',
					'fotorrealismo são proibidos no prompt E filtrados no retorno.',
				].join(' '),
				body: z.object({
					prompt: z.string().max(8_000),
					mode: z.string().max(40).optional(),
				}),
				response: {
					200: z.object({
						enhanced: z.string(),
						suggestions: z.array(z.string()),
						limited: z.boolean().optional(),
					}),
					403: ErrorSchema,
				},
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		enhancePromptController,
	);
}
