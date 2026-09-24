import { MARCA_COLECAO, MARCA_TOOL } from '../lib/marca.js';
import { cache } from '../lib/redis.js';
import { supabaseUpvox } from '../lib/supabase-upvox.js';
import type { CollectionConfig } from '../lib/tool-collections.js';
import {
	type CollectionEntry,
	toolCollectionRepository,
} from './tool-collection.js';

/**
 * Leituras SERVER-SIDE do link público de orçamento.
 *
 * O visitante não autentica, mas o servidor precisa saber DE QUEM é o link para
 * cobrar a pessoa certa. Tudo aqui roda com o cliente de SERVIÇO (service role):
 * é o equivalente a "resolver o slug do lado do servidor" — nenhuma dessas
 * consultas pode ser exposta como endpoint.
 *
 * ZERO TABELA NOVA: link e lead são registros das coleções `links` e `leads` da
 * tool `central_custos`, servidos pelo mesmo repositório genérico das coleções.
 */

export const TOOL_KEY = 'central_custos';
export const COLECAO_LINKS = 'links';
export const COLECAO_LEADS = 'leads';
export const COLECAO_MATERIAIS = 'materiais';

/** `list` só usa `config` para busca textual; aqui filtramos por faceta. */
const CONFIG_VAZIA: CollectionConfig = { fields: [] };

/**
 * Acha o link pelo slug.
 *
 * DOIS PONTOS QUE PARECEM DETALHE E NÃO SÃO:
 *
 * 1. `isStaff: true` é OBRIGATÓRIO aqui. A coleção `links` é
 *    `visibility:'owner'`, e o filtro de dono do repositório precisa saber quem
 *    é o dono — que é exatamente o que estamos tentando descobrir. Este é o
 *    "cliente de serviço" do desenho: o servidor lê, o visitante não.
 *
 * 2. Ordenamos por MAIS ANTIGO e pegamos o primeiro. Sem DDL não existe índice
 *    único no slug (é um campo dentro de um `jsonb`), então dois profissionais
 *    PODEM criar o mesmo slug. Nesse empate, quem chegou primeiro fica com o
 *    link — assim ninguém sequestra o tráfego de um link já divulgado
 *    cadastrando o mesmo slug depois. A colisão é registrada no log.
 */
export async function findLinkBySlug(
	slug: string,
): Promise<CollectionEntry | null> {
	const achados = await toolCollectionRepository.list(
		TOOL_KEY,
		COLECAO_LINKS,
		CONFIG_VAZIA,
		{
			viewer: { customerId: '', isStaff: true },
			filters: { slug: { kind: 'eq', value: slug } },
			sort: 'oldest',
			page: 1,
			pageSize: 2,
		},
	);
	if (achados.total > 1) {
		console.warn(
			`[public-quote] slug '${slug}' duplicado em ${achados.total} links — servindo o mais antigo`,
		);
	}
	return achados.items[0] ?? null;
}

/**
 * O link está no ar?
 *
 * Regra deliberada: DESLIGADO só quando alguém disse explicitamente que está
 * desligado (`ativo === false` no dado, ou o `active` da linha em `false`).
 * Um campo `ativo` AUSENTE conta como ligado — se contasse como desligado, todo
 * link criado por um formulário que não mandou o campo nasceria morto, e o dono
 * não teria como descobrir por quê.
 */
export function linkAtivo(entry: CollectionEntry): boolean {
	if (entry.active === false) return false;
	return entry.data?.ativo !== false;
}

/**
 * Definition da tool lida DIRETO do banco do upvox, sem HTTP.
 *
 * O caminho normal (`loadPublishedToolDefinition`) fala com o upvox por HTTP
 * mandando a identidade do usuário; com `EXTERNAL_API_URL` apontando para o
 * gateway isso exige um Bearer — que no link público NÃO EXISTE, porque o
 * visitante não tem conta. Aqui usamos o cliente de serviço do banco do upvox,
 * que já é usado por outras partes da main API.
 *
 * Sem filtro de `status`: a definition é CONFIGURAÇÃO (quais coleções existem,
 * como interpolar velocidade). Quem decide se a tool pode rodar e cobrar é o
 * upvox, no `withToolBilling` — e é lá que `enabled`/assinatura são conferidos.
 * Duplicar esse gate aqui só criaria dois lugares para errar.
 */
export async function loadToolDocDirect(
	toolKey = TOOL_KEY,
): Promise<Record<string, unknown>> {
	return cache.cacheAside(`pubquote:def:${toolKey}:v1`, 60, async () => {
		const { data, error } = await supabaseUpvox
			.from('ai_tool_definitions')
			.select('definition')
			.eq('tool_key', toolKey)
			.maybeSingle();
		if (error) throw new Error(error.message);
		const doc = (data as { definition?: unknown } | null)?.definition;
		if (!doc || typeof doc !== 'object') {
			throw new Error(`definition de '${toolKey}' não encontrada`);
		}
		return doc as Record<string, unknown>;
	});
}

/**
 * Materiais visíveis para o DONO do link (é o catálogo dele que o cliente final
 * vê). Viewer não-staff de propósito: material reprovado ou inativo não pode
 * aparecer num orçamento que vira preço.
 */
export async function listMateriais(
	ownerId: string,
	toolKey = TOOL_KEY,
): Promise<CollectionEntry[]> {
	const achados = await toolCollectionRepository.list(
		toolKey,
		COLECAO_MATERIAIS,
		CONFIG_VAZIA,
		{
			viewer: { customerId: ownerId, isStaff: false },
			sort: 'title',
			page: 1,
			pageSize: 200,
		},
	);
	return achados.items;
}

/**
 * A MARCA do dono do link — cadastrada uma vez no Estúdio de Imagens, reusada
 * aqui em vez de o profissional cadastrar logo e cor de novo.
 *
 * `mineOnly` + viewer NÃO-STAFF, e os dois importam:
 *  • não-staff é a mesma regra de `listMateriais` — o servidor lê como se
 *    fosse o dono, nunca como administrador;
 *  • `mineOnly` é o cinto: a coleção é `visibility:'owner'`, mas se um dia uma
 *    linha nascer pública (foi assim que a galeria quase vazou), o filtro por
 *    `owner_id` impede que a marca de OUTRO aluno apareça na página pública
 *    deste. Aqui o estrago seria irreversível: logo alheio servido a clientes.
 *
 * `pageSize: 5` e não 1: quem escolhe é `escolherMarca` (lib/marca.ts), que
 * descarta cadastro em branco antes de eleger o mais recente — com uma linha
 * só, um rascunho vazio criado ontem apagaria a marca pronta.
 */
export async function findMarca(ownerId: string): Promise<CollectionEntry[]> {
	if (!ownerId) return [];
	const achados = await toolCollectionRepository.list(
		MARCA_TOOL,
		MARCA_COLECAO,
		CONFIG_VAZIA,
		{
			viewer: { customerId: ownerId, isStaff: false },
			mineOnly: true,
			sort: 'recent',
			page: 1,
			pageSize: 5,
		},
	);
	return achados.items;
}

export interface LeadInput {
	slug: string;
	ownerId: string;
	nome: string;
	whatsapp: string;
	email: string;
	empresa: string;
	ipHash: string;
	precoTotalCents: number;
	arquivoNome: string;
	consentimento: boolean;
	toolKey?: string;
}

/**
 * Grava o lead como registro da coleção `leads` — `visibility:'owner'`, dono =
 * profissional. É contato de terceiro (o cliente final DELE): não pode aparecer
 * em listagem pública nem para outro aluno.
 */
export async function createLead(input: LeadInput): Promise<void> {
	await toolCollectionRepository.create({
		toolKey: input.toolKey ?? TOOL_KEY,
		collection: COLECAO_LEADS,
		title: input.nome || input.whatsapp || input.email || 'Orçamento pelo link',
		description: null,
		category: null,
		status: 'approved',
		ownerId: input.ownerId,
		visibility: 'owner',
		// `createdBy` fica NULO: quem submeteu não tem conta neste sistema, e
		// preencher com o dono mentiria sobre a autoria.
		createdBy: null,
		data: {
			slug: input.slug,
			nome: input.nome,
			whatsapp: input.whatsapp,
			email: input.email,
			empresa: input.empresa,
			ip_hash: input.ipHash,
			preco_total_cents: input.precoTotalCents,
			arquivo_nome: input.arquivoNome,
			consentimento: input.consentimento,
		},
	});
}
