import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	publicQuoteEstimateController,
	publicQuoteInfoController,
} from '../controllers/public-quote.js';
import { ErrorSchema } from '../types/error.js';

/**
 * LINK PÚBLICO DE ORÇAMENTO — rotas SEM `preHandler` de autenticação.
 *
 * É deliberado e é a feature: o cliente final do profissional não tem (e não vai
 * ter) conta aqui. O precedente no repo é `global-promo-link.ts`, cujo GET e
 * `redeem` também são abertos.
 *
 * A diferença — e o motivo de todo o cuidado no controller — é que estas rotas
 * ACEITAM ARQUIVO e GASTAM O DINHEIRO DE UM TERCEIRO. As defesas (limites de
 * multipart por request, sniff de conteúdo, nonce HMAC, honeypot, tetos por IP e
 * por link, idempotência da cobrança) vivem em `controllers/public-quote.ts` e
 * `lib/public-quote.ts`.
 */

const slugParamsSchema = z.object({
	slug: z.string().min(2).max(61),
});

const materialSchema = z.object({
	/** A FAMÍLIA do material ("mdf"), não o id da linha do banco. */
	id: z.string(),
	nome: z.string(),
	espessuras: z.array(z.number()),
});

const campoLeadSchema = z.object({
	name: z.string(),
	label: z.string(),
	required: z.boolean(),
});

/**
 * O que o link mostra. A LISTA DE AUSÊNCIAS É O CONTRATO: nada de custo,
 * markup, taxa-hora, densidade, velocidade, perfil de precificação, tetos
 * configurados nem id do dono.
 */
const infoResponseSchema = z.object({
	titulo: z.string(),
	logo_url: z.string(),
	cor: z.string(),
	/**
	 * ⚠ ESTE SCHEMA É UMA SEGUNDA ALLOW-LIST, e ela é silenciosa.
	 *
	 * O Fastify SERIALIZA a resposta por ele: campo que o controller devolve e
	 * não está declarado aqui some sem erro, sem log e sem 500 — o cliente
	 * recebe o resto certo e o campo simplesmente não existe. Foi o que
	 * aconteceu com `empresa` e `whatsapp`: controller certo, teste passando (a
	 * app de teste monta a rota, mas a asserção olhava o objeto, não o
	 * serializado) e a página em branco no navegador.
	 *
	 * Campo novo na resposta ⇒ campo novo AQUI. Não é opcional.
	 */
	empresa: z.string(),
	whatsapp: z.string(),
	materiais: z.array(materialSchema),
	qtd_max: z.number().int(),
	campos_lead: z.array(campoLeadSchema),
	mostrar_prazo: z.boolean(),
	/** Assinado (HMAC), válido por 30 min e exigido no POST. */
	nonce: z.string(),
});

/**
 * TODOS OS CAMPOS SÃO OPCIONAIS DE PROPÓSITO.
 *
 * O honeypot responde `200 {}` — um robô que preencheu o campo escondido
 * precisa receber algo indistinguível de sucesso, sem gastar vox. Se o schema
 * exigisse os campos, a serialização quebraria justamente nesse caminho e o
 * robô descobriria a defesa pelo 500.
 */
const estimateResponseSchema = z.object({
	price_unit_cents: z.number().int().optional(),
	price_total_cents: z.number().int().optional(),
	qtd: z.number().int().optional(),
	prazo_dias: z.number().int().optional(),
	dims_mm: z.object({ largura: z.number(), altura: z.number() }).optional(),
	pecas: z.number().int().optional(),
	resumo: z.string().optional(),
	avisos: z.array(z.string()).optional(),
	/** Velocidade de corte estimada, não medida. Ver `infoResponseSchema`. */
	estimativa: z.boolean().optional(),
	/**
	 * Desconto por quantidade já embutido no total (0–100). Sem ele a proposta
	 * imprimia "10 × R$ 13,00" ao lado de "R$ 123,50". Ver `RespostaEstimate`.
	 */
	desconto_pct: z.number().optional(),
});

export async function publicQuoteRoute(server: FastifyInstance) {
	server.get(
		'/api/public/quote/:slug',
		{
			schema: {
				description:
					'Link público de orçamento: o que o cliente final do profissional pode escolher. Sem autenticação. Devolve um nonce assinado (30 min) que o POST exige.',
				params: slugParamsSchema,
				response: {
					200: infoResponseSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Public Quote'],
			},
		},
		publicQuoteInfoController,
	);

	server.post(
		'/api/public/quote/:slug/estimate',
		{
			schema: {
				description: [
					'Orçamento público (multipart). Sem autenticação — os voxxys saem do DONO do link.',
					'',
					'Campos: `arquivo` (DXF/SVG, até 8 MB), `nonce` (do GET), `material`,',
					'`espessura_mm`, `qtd` e, quando o link pede lead, `nome`/`whatsapp`/',
					'`email`/`empresa`/`consentimento`. O campo `website` é um honeypot: se',
					'vier preenchido, a resposta é 200 vazio e nada é cobrado.',
					'',
					'Erros: 400 dados/nonce, 413 arquivo ou desenho grande demais,',
					'415 arquivo que não é DXF/SVG, 429 teto por IP ou por link,',
					'402 orçamento indisponível (mensagem neutra: nunca dizemos por quê).',
				].join('\n'),
				params: slugParamsSchema,
				consumes: ['multipart/form-data'],
				response: {
					200: estimateResponseSchema,
					400: ErrorSchema,
					402: ErrorSchema,
					404: ErrorSchema,
					413: ErrorSchema,
					415: ErrorSchema,
					429: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Public Quote'],
			},
		},
		publicQuoteEstimateController,
	);
}
