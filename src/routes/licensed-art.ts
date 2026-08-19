import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateCustomer } from '../middleware/auth.js';
import {
	buscarPorCodigo,
	listarDoCliente,
} from '../repositories/licensed-art.js';
import { ErrorSchema } from '../types/error.js';

const codigoParams = z.object({ code: z.string().min(6).max(64) });

const verificacaoSchema = z.object({
	code: z.string(),
	valid: z.boolean(),
	status: z.enum(['active', 'revoked']),
	/** O que foi licenciado, em linguagem de gente. */
	content: z.string(),
	featureKey: z.string(),
	licensorName: z.string().nullable(),
	previewUrl: z.string().nullable(),
	issuedAt: z.string(),
	checkedAt: z.string(),
});

const minhaArteSchema = z.object({
	id: z.string(),
	code: z.string(),
	featureKey: z.string(),
	licensorName: z.string().nullable(),
	previewUrl: z.string().nullable(),
	promptTitle: z.string().nullable(),
	revoked: z.boolean(),
	issuedAt: z.string(),
});

/**
 * Autenticidade da arte licenciada.
 *
 * A verificação é PÚBLICA e sem login, de propósito: quem escaneia o QR gravado
 * num chaveiro comprado numa feira não tem conta na plataforma. Um QR que só
 * funciona para quem já é cliente não serve para nada.
 */
export async function licensedArtRoute(server: FastifyInstance) {
	server.get(
		'/api/licensed-art/:code',
		{
			schema: {
				description:
					'Verificação pública do QR gravado na peça. Sem autenticação.',
				params: codigoParams,
				response: { 200: verificacaoSchema, 404: ErrorSchema },
				tags: ['Licensed Art'],
			},
		},
		async (request, reply) => {
			const { code } = request.params as z.infer<typeof codigoParams>;
			const art = await buscarPorCodigo(code);

			// Código inexistente é 404, NÃO uma resposta com `valid:false`.
			// "não existe" e "existe mas foi revogada" são coisas diferentes, e
			// juntar as duas esconderia uma falsificação atrás de uma revogação.
			if (!art) {
				return reply
					.status(404)
					.send({ message: 'Código não encontrado.', code: 'not_found' });
			}

			// Cacheável por CDN: a resposta é a mesma para todo mundo e não carrega
			// nada do comprador. Curto porque revogação precisa aparecer rápido.
			reply.header('Cache-Control', 'public, max-age=60');

			return reply.send({
				code: art.code,
				valid: !art.revoked_at,
				status: art.revoked_at ? ('revoked' as const) : ('active' as const),
				content: art.prompt_title ?? art.licensor_name ?? art.feature_key,
				featureKey: art.feature_key,
				licensorName: art.licensor_name,
				previewUrl: art.preview_url,
				issuedAt: art.created_at,
				checkedAt: new Date().toISOString(),
			});
		},
	);

	server.get(
		'/api/me/licensed-art',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'As artes licenciadas que eu gerei.',
				response: {
					200: z.array(minhaArteSchema),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Licensed Art'],
			},
		},
		async (request, reply) => {
			// `currentCustomer` é populado pelo authenticateCustomer para aluno;
			// para staff o middleware retorna cedo e só `currentUser` existe.
			const customerId = request.currentCustomer?.id ?? request.currentUser?.id;
			if (!customerId) {
				return reply
					.status(401)
					.send({ message: 'Não autenticado.', code: 'unauthorized' });
			}

			const artes = await listarDoCliente(customerId);
			return reply.send(
				artes.map((a) => ({
					id: a.id,
					code: a.code,
					featureKey: a.feature_key,
					licensorName: a.licensor_name,
					previewUrl: a.preview_url,
					promptTitle: a.prompt_title,
					revoked: Boolean(a.revoked_at),
					issuedAt: a.created_at,
				})),
			);
		},
	);
}
