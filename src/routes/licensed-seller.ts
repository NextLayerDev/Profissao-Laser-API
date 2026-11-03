import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { TERMO_CLAUSULAS, TERMO_VERSAO } from '../lib/licensed-terms.js';
import { authenticateAdmin, authenticateCustomer } from '../middleware/auth.js';
import {
	adicionarCanal,
	declaracaoEmDia,
	listarVendedores,
	registrarAceite,
	removerCanal,
} from '../repositories/licensed-seller.js';
import { ErrorSchema } from '../types/error.js';

/**
 * O PORTÃO DO VENDEDOR — quem gera arte de marca declara onde vende.
 *
 * A volumetria já diz quantas peças de cada escudo saíram. Ela não diz ONDE
 * elas aparecem, que é a pergunta seguinte do clube. Estas rotas são a outra
 * metade do relatório.
 */

/**
 * Mesmo helper de `licensed-art.ts`, e pelo mesmo motivo.
 *
 * `request.user.id` não existe nesta API — foi exatamente esse engano que fez a
 * biblioteca responder 401 sozinha e deslogar o aluno. O dono é
 * `currentCustomer` e, quando ele não existe (staff), `currentUser`.
 */
function donoDaDeclaracao(request: FastifyRequest): string | undefined {
	return request.currentCustomer?.id ?? request.currentUser?.id;
}

/** IP em hash, nunca em claro — mesmo tratamento do lead do orçamento público. */
function hashDoIp(request: FastifyRequest): string | null {
	const ip = request.ip;
	if (!ip) return null;
	return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

const canalSchema = z.object({
	id: z.string(),
	url: z.string(),
	label: z.string().nullable(),
	createdAt: z.string(),
});

/**
 * ⚠️ TODO CAMPO PRECISA ESTAR AQUI. O Fastify serializa contra este schema e
 * PODA em silêncio o que não estiver declarado — já custou o código de licença
 * sumindo da resposta uma vez, e o `pieceLabel` outra.
 */
const declaracaoSchema = z.object({
	status: z.enum([
		'sem_canal',
		'termo_pendente',
		'lista_mudou',
		'termo_mudou',
		'ok',
	]),
	ok: z.boolean(),
	channels: z.array(canalSchema),
	/** O texto vigente viaja junto: é ele que dá sentido à versão registrada. */
	terms: z.object({
		version: z.string(),
		clauses: z.array(z.object({ titulo: z.string(), texto: z.string() })),
	}),
	accepted: z.object({ version: z.string(), at: z.string() }).nullable(),
});

const vendedorSchema = z.object({
	customerId: z.string(),
	channels: z.array(
		z.object({ url: z.string(), label: z.string().nullable() }),
	),
	acceptedAt: z.string().nullable(),
	acceptedVersion: z.string().nullable(),
	upToDate: z.boolean(),
});

/** O endereço tem de ser http(s) e ter host. Nem mais, nem menos. */
const urlSchema = z
	.string()
	.trim()
	.min(4)
	.max(500)
	.refine((v) => {
		try {
			const u = new URL(v.includes('://') ? v : `https://${v}`);
			return (
				(u.protocol === 'http:' || u.protocol === 'https:') &&
				u.hostname.includes('.')
			);
		} catch {
			return false;
		}
	}, 'Endereço inválido — informe o link da loja (ex.: https://sualoja.com.br).');

export async function licensedSellerRoute(server: FastifyInstance) {
	/** O estado da declaração de quem está logado, com o texto vigente junto. */
	server.get(
		'/api/me/licensed-seller',
		{
			schema: {
				tags: ['Arte Licenciada'],
				summary: 'Declaração de canais de venda do aluno',
				response: { 200: declaracaoSchema, 403: ErrorSchema },
			},
			preHandler: [authenticateCustomer],
		},
		async (request, reply) => {
			const customerId = donoDaDeclaracao(request);
			if (!customerId) {
				return reply.status(403).send({ message: 'Customer not found' });
			}
			const d = await declaracaoEmDia(customerId);
			return reply.send({
				status: d.status,
				ok: d.ok,
				channels: d.canais.map((c) => ({
					id: c.id,
					url: c.url,
					label: c.label,
					createdAt: c.created_at,
				})),
				terms: { version: TERMO_VERSAO, clauses: TERMO_CLAUSULAS },
				accepted: d.aceite
					? { version: d.aceite.terms_version, at: d.aceite.accepted_at }
					: null,
			});
		},
	);

	server.post(
		'/api/me/licensed-seller/channels',
		{
			schema: {
				tags: ['Arte Licenciada'],
				summary: 'Adiciona um canal de venda',
				body: z.object({
					url: urlSchema,
					label: z.string().trim().max(80).optional(),
				}),
				response: { 201: canalSchema, 400: ErrorSchema, 403: ErrorSchema },
			},
			preHandler: [authenticateCustomer],
		},
		async (request, reply) => {
			const customerId = donoDaDeclaracao(request);
			if (!customerId) {
				return reply.status(403).send({ message: 'Customer not found' });
			}
			const { url, label } = request.body as { url: string; label?: string };
			// Normaliza a falta de protocolo: quem copia da barra do navegador cola
			// "sualoja.com.br" e não deveria levar erro por isso.
			const completa = url.includes('://') ? url : `https://${url}`;
			const canal = await adicionarCanal({ customerId, url: completa, label });
			return reply.status(201).send({
				id: canal.id,
				url: canal.url,
				label: canal.label,
				createdAt: canal.created_at,
			});
		},
	);

	server.delete(
		'/api/me/licensed-seller/channels/:id',
		{
			schema: {
				tags: ['Arte Licenciada'],
				summary: 'Tira um canal da lista',
				params: z.object({ id: z.string().uuid() }),
				response: {
					200: z.object({ removed: z.boolean() }),
					403: ErrorSchema,
					404: ErrorSchema,
				},
			},
			preHandler: [authenticateCustomer],
		},
		async (request, reply) => {
			const customerId = donoDaDeclaracao(request);
			if (!customerId) {
				return reply.status(403).send({ message: 'Customer not found' });
			}
			const { id } = request.params as { id: string };
			const ok = await removerCanal(id, customerId);
			if (!ok)
				return reply.status(404).send({ message: 'Canal não encontrado.' });
			return reply.send({ removed: true });
		},
	);

	server.post(
		'/api/me/licensed-seller/accept',
		{
			schema: {
				tags: ['Arte Licenciada'],
				summary: 'Aceita o termo com a lista de canais de agora',
				response: { 200: declaracaoSchema, 400: ErrorSchema, 403: ErrorSchema },
			},
			preHandler: [authenticateCustomer],
		},
		async (request, reply) => {
			const customerId = donoDaDeclaracao(request);
			if (!customerId) {
				return reply.status(403).send({ message: 'Customer not found' });
			}
			try {
				await registrarAceite({ customerId, ipHash: hashDoIp(request) });
			} catch (err) {
				const msg = err instanceof Error ? err.message : '';
				if (msg.includes('nenhum canal')) {
					return reply.status(400).send({
						message: 'Cadastre ao menos um canal de venda antes de aceitar.',
					});
				}
				throw err;
			}
			const d = await declaracaoEmDia(customerId);
			return reply.send({
				status: d.status,
				ok: d.ok,
				channels: d.canais.map((c) => ({
					id: c.id,
					url: c.url,
					label: c.label,
					createdAt: c.created_at,
				})),
				terms: { version: TERMO_VERSAO, clauses: TERMO_CLAUSULAS },
				accepted: d.aceite
					? { version: d.aceite.terms_version, at: d.aceite.accepted_at }
					: null,
			});
		},
	);

	/**
	 * O relatório de staff. Com `feature_key`, só quem de fato gerou peça daquela
	 * marca — que é o recorte entregável ao clube.
	 */
	server.get(
		'/api/licensed-seller',
		{
			schema: {
				tags: ['Arte Licenciada'],
				summary: 'Vendedores declarados (staff)',
				querystring: z.object({ feature_key: z.string().optional() }),
				response: { 200: z.array(vendedorSchema), 403: ErrorSchema },
			},
			preHandler: [authenticateAdmin],
		},
		async (request, reply) => {
			const { feature_key } = request.query as { feature_key?: string };
			const linhas = await listarVendedores(feature_key);
			return reply.send(
				linhas.map((v) => ({
					customerId: v.customerId,
					channels: v.canais,
					acceptedAt: v.aceiteEm,
					acceptedVersion: v.versaoAceita,
					upToDate: v.emDia,
				})),
			);
		},
	);
}
