import type { FastifyReply, FastifyRequest } from 'fastify';
import { readDxf } from '../lib/cad/dxf-read.js';
import { readSvg, sniffFormat } from '../lib/cad/svg-read.js';
import {
	analyzeGeometry,
	type CadMetrics,
	diagnose,
} from '../lib/cad/topology.js';
import { escolherMarca, visualDaMarca } from '../lib/marca.js';
import {
	CPU_BUDGET_MS,
	clientIp,
	HONEYPOT_FIELD,
	hashIp,
	IDEMPOTENCIA_TTL_S,
	IP_POR_DIA,
	IP_POR_HORA,
	idempotencyKey,
	issueNonce,
	JANELA_DIA_S,
	JANELA_HORA_S,
	JANELA_MES_S,
	listaDeNumeros,
	listaDeTexto,
	MAX_CONTORNOS_PUBLICO,
	MAX_ENTIDADES_PUBLICO,
	MAX_FIELD_BYTES,
	MAX_FIELDS,
	MAX_FILES,
	MAX_UPLOAD_BYTES,
	MSG,
	nomeArquivoSeguro,
	nonceFalhou,
	prazoEstourado,
	saneiaTexto,
	saneiaUrl,
	sha256,
	slugValido,
	TETO_DIA_PADRAO,
	TETO_MES_PADRAO,
	textoCurto,
	verifyNonce,
} from '../lib/public-quote.js';
import { ToolEngineError } from '../lib/tool-errors.js';
import {
	cobrancaFalhou,
	type ToolChargeInput,
	type ToolChargeResult,
} from '../lib/upvox-internal.js';
import type { CollectionEntry } from '../repositories/tool-collection.js';
import type { orcamentoPublico } from '../tool-blocks/blocks/quote.js';
import { DIAG_PUBLICOS, quotePriceBlock } from '../tool-blocks/blocks/quote.js';

/**
 * O orçamento público que `quote.price` já monta (F5). Derivado do tipo de
 * retorno da função de lá para NÃO poder divergir: se alguém mudar o nome de um
 * campo no bloco, isto quebra na compilação em vez de virar `undefined` no
 * preço que o cliente final recebe.
 */
type OrcamentoPublico = ReturnType<typeof orcamentoPublico>;

/**
 * LINK PÚBLICO DE ORÇAMENTO — o controller.
 *
 * O profissional gera um link; o CLIENTE FINAL dele abre sem login, sobe um
 * DXF/SVG, escolhe material/espessura/quantidade e recebe o preço na hora. Os
 * voxxys saem do DONO DO LINK, nunca do visitante.
 *
 * Duas invariantes mandam em tudo que está aqui:
 *
 *   1. NENHUM NÚMERO DE CUSTO SAI. A resposta pública é montada campo a campo
 *      (`montaResposta`), nunca por remoção de campos de um objeto rico. Custo,
 *      markup, taxa-hora, densidade, velocidade e perfil são o negócio do
 *      profissional — vazar isso para o cliente final dele é o pior estrago que
 *      esta rota pode fazer, e é irreversível.
 *
 *   2. NADA GASTA DINHEIRO ANTES DE TODAS AS DEFESAS PASSAREM. A ordem das
 *      etapas é parte da segurança, não estilo: TETO POR IP (antes até de ler o
 *      corpo) → honeypot → nonce → tipo de arquivo → cardápio do link →
 *      CÁLCULO → teto por link → COBRANÇA. Só a última custa dinheiro, e só se
 *      a requisição chegou até ela.
 *
 * As dependências entram por injeção (`PublicQuoteDeps`) para os testes e o
 * smoke poderem exercitar os cenários de ataque contra ESTE controller, com
 * Fastify de verdade e multipart de verdade, sem banco e sem rede.
 */

/* ─────────────────────────── Injeção de dependências ─────────────────────── */

export interface PublicQuoteDeps {
	findLink(slug: string): Promise<CollectionEntry | null>;
	linkAtivo(entry: CollectionEntry): boolean;
	listMateriais(ownerId: string): Promise<CollectionEntry[]>;
	/**
	 * A marca cadastrada pelo DONO do link (coleção `marca` do Estúdio de
	 * Imagens). Só é chamada quando o link pede — ver `usar_marca` em
	 * `infoDoLink`.
	 */
	findMarca(ownerId: string): Promise<CollectionEntry[]>;
	loadToolDoc(): Promise<Record<string, unknown>>;
	createLead(input: {
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
	}): Promise<void>;
	charge(input: ToolChargeInput): Promise<ToolChargeResult>;
	/** INCR com TTL. `-1` = sem Redis → sem teto (fail-open). */
	incr(key: string, ttlSeconds: number): Promise<number>;
	/** Cache-aside; é ele que dá idempotência à cobrança. */
	cacheAside<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T>;
	/** Avisa o dono que o link parou por falta de saldo. Best-effort. */
	avisaDono(input: {
		para: string;
		slug: string;
		titulo: string;
	}): Promise<void> | void;
	agora(): number;
}

/* ─────────────────────────────── Utilidades ─────────────────────────────── */

/** `data` de um registro de coleção. */
type Row = Record<string, unknown>;

function txt(v: unknown): string {
	return typeof v === 'string'
		? v
		: v === undefined || v === null
			? ''
			: String(v);
}

function num(v: unknown): number | undefined {
	if (v === undefined || v === null || v === '') return undefined;
	const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
	return Number.isFinite(n) ? n : undefined;
}

/**
 * Telefone reduzido ao que um `wa.me` aceita: só dígitos.
 *
 * Não é formatação — é allowlist, na mesma família de `saneiaUrl`. O dono do
 * link digita este valor e ele acaba dentro de um `href` na página do CLIENTE
 * FINAL dele. Um número curto demais para ser telefone (menos de 8 dígitos) sai
 * como vazio: melhor a página não oferecer contato do que oferecer um link
 * quebrado num documento que representa a empresa de alguém.
 */
function soDigitos(v: string, max: number): string {
	const d = v.replace(/\D+/g, '').slice(0, max);
	return d.length >= 8 ? d : '';
}

/** Erro com status HTTP e mensagem JÁ NEUTRA (nada aqui é para o visitante ler). */
class RespostaPublica extends Error {
	constructor(
		readonly status: number,
		readonly mensagem: string,
		/** Só para log — nunca vai na resposta. */
		readonly motivo = '',
	) {
		super(mensagem);
	}
}

/* ───────────────────────── Materiais oferecidos ───────────────────────── */

export interface MaterialPublico {
	/** A FAMÍLIA, não o UUID do registro: id de linha do banco não vira URL pública. */
	id: string;
	nome: string;
	espessuras: number[];
}

/**
 * O cardápio que o link oferece: interseção entre o catálogo do profissional,
 * o que o link permite e as espessuras que ele permite.
 *
 * Usado no GET (para desenhar o formulário) E no POST (para validar o que
 * voltou). Tem que ser a MESMA função nos dois: se o POST validasse por outra
 * regra, dava para pedir preço de um material que o link não oferece.
 */
export function materiaisDoLink(
	link: CollectionEntry,
	entries: CollectionEntry[],
): MaterialPublico[] {
	const permitidos = new Set(listaDeTexto(link.data?.materiais_permitidos));
	const espPermitidas = listaDeNumeros(link.data?.espessuras_permitidas);

	const porFamilia = new Map<string, MaterialPublico>();
	for (const e of entries) {
		const d = (e.data ?? {}) as Row;
		// Material que não corta a laser não entra no cardápio: `quote.price` o
		// BLOQUEIA de qualquer jeito (PVC libera cloro), e oferecer para depois
		// recusar é pior do que não oferecer.
		if (txt(d.laser) === 'nao') continue;

		const familia = txt(d.familia).trim().toLowerCase();
		if (!familia) continue;
		if (permitidos.size && !permitidos.has(familia)) continue;

		let espessuras = listaDeNumeros(d.espessuras);
		if (espPermitidas.length) {
			espessuras = espessuras.length
				? espessuras.filter((n) => espPermitidas.includes(n))
				: espPermitidas;
		}
		if (!espessuras.length) continue;

		const anterior = porFamilia.get(familia);
		if (anterior) {
			// Mesma família com vários registros (chapas diferentes): a união das
			// espessuras é o que o cliente final pode pedir.
			anterior.espessuras = [
				...new Set([...anterior.espessuras, ...espessuras]),
			].sort((a, b) => a - b);
			continue;
		}
		porFamilia.set(familia, {
			id: familia,
			nome: saneiaTexto(e.title || familia, 80),
			espessuras,
		});
	}
	return [...porFamilia.values()];
}

/* ───────────────────────────── Campos do lead ───────────────────────────── */

export interface CampoLead {
	name: string;
	label: string;
	required: boolean;
}

const CAMPOS_LEAD: CampoLead[] = [
	{ name: 'nome', label: 'Seu nome', required: true },
	{ name: 'whatsapp', label: 'WhatsApp', required: true },
	{ name: 'email', label: 'E-mail', required: false },
	{ name: 'empresa', label: 'Empresa', required: false },
	{
		name: 'consentimento',
		label: 'Autorizo o contato sobre este orçamento',
		required: true,
	},
];

/* ─────────────────── Identidade visual: link ou marca ─────────────────── */

/**
 * DE ONDE SAEM O LOGO E A COR DA PÁGINA PÚBLICA.
 *
 * O link sempre pediu `logo_url` e `cor` — que é exatamente o que a coleção
 * `marca` (Estúdio de Imagens) já guarda. Pedir duas vezes é o que o cadastro
 * único existe para acabar; mas trocar a origem por baixo de quem já tem link
 * no ar seria mudar, sem aviso, uma página que os CLIENTES dele já viram.
 *
 * ┌─ A REGRA, e por que ela é um interruptor e não uma esperteza ────────────┐
 * │ `usar_marca` AUSENTE ou `false` (todo link que existe hoje):             │
 * │     comportamento idêntico ao de antes, byte a byte. Nem sequer          │
 * │     consultamos a marca — não há leitura a mais, não há como o           │
 * │     resultado mudar.                                                     │
 * │                                                                          │
 * │ `usar_marca: true` (o aluno ligou, sabendo o que ligou):                 │
 * │     a MARCA MANDA, e o campo do link vira reserva do que a marca não     │
 * │     tiver. A ordem é essa e não a inversa: quem liga o interruptor está  │
 * │     dizendo "use a identidade da minha empresa", e uma cor velha         │
 * │     esquecida no link não pode ganhar dessa frase — o aluno mudaria a    │
 * │     cor da marca, veria a página continuar igual e não teria como        │
 * │     descobrir por quê. A reserva serve ao caso real de a marca ainda não │
 * │     ter logo: aí o logo que ele já tinha no link continua aparecendo, em │
 * │     vez de a página ficar sem nada.                                      │
 * │                                                                          │
 * │ E se a leitura da marca falhar (a tool está em draft, o banco piscou), a │
 * │ página cai na configuração do próprio link em vez de dar erro: um link   │
 * │ público que sai do ar por causa de uma cor é uma troca péssima.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
async function visualDoLink(
	d: Row,
	ownerId: string,
	deps: PublicQuoteDeps,
): Promise<{ logo_url: string; cor: string; empresa: string }> {
	// `empresa` só existe quando a marca é lida: o link nunca teve campo de nome
	// da empresa (tem `titulo`, que é o título do documento, coisa diferente).
	const doLink = { logo_url: txt(d.logo_url), cor: txt(d.cor), empresa: '' };
	if (d.usar_marca !== true || !ownerId) return doLink;
	try {
		const daMarca = visualDaMarca(escolherMarca(await deps.findMarca(ownerId)));
		return {
			logo_url: daMarca.logo_url || doLink.logo_url,
			cor: daMarca.cor || doLink.cor,
			empresa: daMarca.nome,
		};
	} catch (e) {
		console.warn(
			`[public-quote] marca do dono não pôde ser lida, usando a configuração do link: ${
				e instanceof Error ? e.message : String(e)
			}`,
		);
		return doLink;
	}
}

/* ────────────────────────────── GET /:slug ────────────────────────────── */

/**
 * O que o link mostra ao cliente final.
 *
 * A LISTA DE OMISSÕES É O CONTRATO: não sai custo, markup, taxa-hora,
 * densidade, velocidade, id de perfil, id do dono, nem os tetos configurados
 * (que contariam ao concorrente quantos orçamentos o profissional recebe).
 */
export async function infoDoLink(
	slug: unknown,
	deps: PublicQuoteDeps,
): Promise<{
	titulo: string;
	logo_url: string;
	cor: string;
	empresa: string;
	whatsapp: string;
	materiais: MaterialPublico[];
	qtd_max: number;
	campos_lead: CampoLead[];
	mostrar_prazo: boolean;
	nonce: string;
}> {
	if (!slugValido(slug)) {
		throw new RespostaPublica(404, MSG.linkInvalido, 'slug fora do formato');
	}
	const link = await deps.findLink(slug);
	if (!link || !deps.linkAtivo(link)) {
		// 404 tanto para inexistente quanto para desligado: a diferença contaria
		// ao visitante que o link EXISTE, o que já é informação sobre o dono.
		throw new RespostaPublica(404, MSG.linkInvalido, 'link ausente/inativo');
	}
	const d = (link.data ?? {}) as Row;
	const ownerId = link.owner_id ?? '';
	const materiais = ownerId
		? materiaisDoLink(link, await deps.listMateriais(ownerId))
		: [];
	const visual = await visualDoLink(d, ownerId, deps);

	return {
		// Tudo que a PÁGINA vai renderizar passa pelo higienizador. O dono do link
		// escolhe estes valores, mas quem os lê é o cliente FINAL dele, numa página
		// no nosso domínio — então nem o dono pode injetar marcação aqui.
		//
		// A MARCA NÃO É EXCEÇÃO: ela é escrita pelo aluno em outra tela, o que a
		// deixa exatamente tão suspeita quanto o que ele digitou aqui. Por isso
		// `visualDoLink` devolve valor CRU e a higienização continua sendo a
		// última coisa que acontece, num lugar só.
		titulo: saneiaTexto(txt(d.titulo) || link.title || 'Orçamento', 120),
		logo_url: saneiaUrl(visual.logo_url),
		cor: saneiaTexto(visual.cor, 32),
		empresa: saneiaTexto(visual.empresa, 120),
		/**
		 * O WHATSAPP JÁ ESTAVA CADASTRADO NO LINK E A PÁGINA NUNCA O MOSTROU.
		 *
		 * O cliente final recebia o preço e não tinha para onde ir: o único botão
		 * da página era "Recalcular". Um orçamento sem caminho para fechar o
		 * pedido é um orçamento que morre na tela.
		 *
		 * Sai só o que vira link `wa.me`: DÍGITOS. Isso não é economia de bytes —
		 * é a higienização. O valor é digitado pelo dono do link e renderizado
		 * para terceiros no nosso domínio; deixá-lo passar como texto livre daria
		 * a ele um campo arbitrário dentro de um `href`. Com dígitos, o pior
		 * conteúdo possível é um número de telefone errado.
		 */
		whatsapp: soDigitos(txt(d.whatsapp), 15),
		materiais,
		qtd_max: Math.max(1, Math.min(100_000, num(d.qtd_max) ?? 50)),
		campos_lead: d.pedir_lead === true ? CAMPOS_LEAD : [],
		mostrar_prazo: d.mostrar_prazo === true,
		nonce: issueNonce(slug, deps.agora()),
	};
}

/* ──────────────────────── POST /:slug/estimate ──────────────────────── */

/** O que o multipart entregou, já em memória e já limitado. */
export interface EntradaEstimate {
	slug: unknown;
	campos: Record<string, string>;
	arquivo: Buffer | null;
	arquivoNome: string;
	ipHash: string;
}

export interface RespostaEstimate {
	price_unit_cents?: number;
	price_total_cents?: number;
	qtd?: number;
	prazo_dias?: number;
	dims_mm?: { largura: number; altura: number };
	pecas?: number;
	resumo?: string;
	avisos?: string[];
	/**
	 * `true` = a velocidade de corte saiu de um MODELO, não de uma medição na
	 * máquina do profissional. O motor já marcava isso (`confidence 0,40`) e a
	 * página do cliente final nunca contou — ele recebia um preço estimado com
	 * cara de preço fechado.
	 *
	 * Não é vazamento: não diz de onde veio a estimativa, nem a confiança, nem a
	 * velocidade. Diz só o que qualquer proposta honesta diz — "este número ainda
	 * pode mudar".
	 */
	estimativa?: boolean;
	/**
	 * Desconto por quantidade JÁ aplicado no total (0–100).
	 *
	 * Sem ele a proposta não fechava: a página imprimia "10 peças · R$ 13,00
	 * cada" ao lado de "R$ 123,50", e o cliente somava 10 × 13,00 = 130,00. O
	 * desconto existia, era o motivo dos R$ 6,50 que faltavam, e a página não o
	 * citava em lugar nenhum — parecia erro de conta de quem mandou o orçamento.
	 *
	 * Não é vazamento: o desconto de faixa é uma condição comercial que o
	 * profissional CONCEDE ao cliente. Custo, markup e margem continuam fora.
	 */
	desconto_pct?: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Monta a resposta pública CAMPO A CAMPO, a partir dos poucos valores que o
 * cliente final tem direito de ver.
 *
 * NUNCA parta do `breakdown` removendo o que não pode sair. Blocklist envelhece
 * mal: basta o precificador ganhar um campo novo — `custo_gas_cents`, digamos —
 * para ele estrear vazando no dia do deploy, sem ninguém notar. Aqui, campo
 * novo no `breakdown` simplesmente não aparece.
 */
function montaResposta(input: {
	precoUnitCents: number;
	precoTotalCents: number;
	qtd: number;
	prazoDias?: number;
	metrics: CadMetrics;
	resumo: string;
	avisos: string[];
	estimativa: boolean;
	descontoPct: number;
}): RespostaEstimate {
	return {
		estimativa: input.estimativa,
		desconto_pct: r3(input.descontoPct),
		price_unit_cents: Math.round(input.precoUnitCents),
		price_total_cents: Math.round(input.precoTotalCents),
		qtd: input.qtd,
		...(input.prazoDias === undefined ? {} : { prazo_dias: input.prazoDias }),
		dims_mm: {
			largura: r3(input.metrics.bbox.w),
			altura: r3(input.metrics.bbox.h),
		},
		pecas: input.metrics.n_pecas,
		resumo: input.resumo,
		avisos: input.avisos,
	};
}

/**
 * O núcleo do POST. Recebe o multipart JÁ LIDO (limites aplicados lá fora, ver
 * `lePartes`) e devolve `{ status, body }`.
 *
 * A ORDEM ABAIXO É A DEFESA. Ler de cima para baixo é ler o custo crescente de
 * cada etapa: string → HMAC → sniff → Redis → CPU → dinheiro.
 */
export async function estimarOrcamento(
	entrada: EntradaEstimate,
	deps: PublicQuoteDeps,
): Promise<{ status: number; body: RespostaEstimate | { message: string } }> {
	try {
		const body = await executa(entrada, deps);
		return { status: 200, body };
	} catch (err) {
		if (err instanceof RespostaPublica) {
			if (err.motivo) {
				console.warn(
					`[public-quote] ${err.status} ${err.mensagem} (${err.motivo})`,
				);
			}
			return { status: err.status, body: { message: err.mensagem } };
		}
		// Os leitores e a topologia lançam `ToolEngineError(413)` nos tetos de
		// bomba de expansão. Esse status TEM que chegar ao cliente como 413 — se
		// virasse 500, o visitante não saberia que o problema é o arquivo dele, e
		// nós não distinguiríamos ataque de arquivo pesado no monitoramento.
		if (err instanceof ToolEngineError) {
			// 413 = bomba de expansão (entidades/contornos): é do arquivo, e o
			// visitante tem o que fazer com essa informação ("simplifique").
			if (err.status === 413) {
				return { status: 413, body: { message: MSG.arquivoGrande } };
			}
			// 400 = uso inválido (material bloqueado para laser, por exemplo).
			if (err.status === 400) {
				return { status: 400, body: { message: MSG.dadosInvalidos } };
			}
			// 403/404/502 vêm de perfil/coleção/definition do DONO. Nada disso é
			// assunto do visitante: neutro.
			console.error(`[public-quote] motor ${err.status}: ${err.message}`);
			return { status: 500, body: { message: MSG.indisponivel } };
		}
		console.error('[public-quote] falha inesperada:', err);
		return { status: 500, body: { message: MSG.indisponivel } };
	}
}

async function executa(
	entrada: EntradaEstimate,
	deps: PublicQuoteDeps,
): Promise<RespostaEstimate> {
	const { campos } = entrada;

	/* 1. slug + link ------------------------------------------------------- */
	if (!slugValido(entrada.slug)) {
		throw new RespostaPublica(404, MSG.linkInvalido, 'slug fora do formato');
	}
	const slug = entrada.slug;
	const link = await deps.findLink(slug);
	if (!link || !deps.linkAtivo(link)) {
		throw new RespostaPublica(404, MSG.linkInvalido, 'link ausente/inativo');
	}
	const d = (link.data ?? {}) as Row;
	const ownerId = link.owner_id ?? '';
	if (!ownerId) {
		// Link órfão não tem quem pague. Neutro para o visitante.
		throw new RespostaPublica(404, MSG.linkInvalido, 'link sem dono');
	}

	/* 2. honeypot ---------------------------------------------------------- */
	// PRIMEIRA coisa depois de saber que o link existe, e ANTES do nonce: robô
	// de formulário preenche todo campo que encontra. Devolvemos 200 vazio — ele
	// registra sucesso e vai embora, sem gastar um centavo do dono e sem
	// aprender que existe uma defesa.
	if (txt(campos[HONEYPOT_FIELD]).trim() !== '') {
		return {};
	}

	/* 3. nonce (HMAC + TTL + tempo mínimo) --------------------------------- */
	const nonce = verifyNonce(slug, campos.nonce, deps.agora());
	if (nonceFalhou(nonce)) {
		// 400 e não 429: o cliente mandou um token inválido/vencido, e a tela
		// precisa saber que basta recarregar. A mensagem é a mesma para os quatro
		// motivos (ausente, malformado, assinatura, expirado, rápido demais) —
		// dizer qual deles é ensinar o robô a corrigir.
		throw new RespostaPublica(400, MSG.sessaoExpirada, `nonce ${nonce.motivo}`);
	}

	/* 4. arquivo: extensão + conteúdo (mimetype IGNORADO) ------------------ */
	if (!entrada.arquivo || entrada.arquivo.byteLength === 0) {
		throw new RespostaPublica(400, MSG.dadosInvalidos, 'sem arquivo');
	}
	const ext = entrada.arquivoNome.toLowerCase().split('.').pop() ?? '';
	if (ext !== 'dxf' && ext !== 'svg') {
		throw new RespostaPublica(415, MSG.arquivoInvalido, `extensão '${ext}'`);
	}
	// O CONTEÚDO manda. A extensão sozinha é chute do cliente; o mimetype é pior
	// ainda (o mesmo .dxf chega como application/dxf, image/vnd.dxf,
	// application/octet-stream ou text/plain conforme o sistema do visitante).
	const formato = sniffFormat(entrada.arquivo);
	if (!formato) {
		throw new RespostaPublica(415, MSG.arquivoInvalido, 'sniff não reconheceu');
	}
	// Extensão e conteúdo TÊM que concordar: `.svg` com DXF dentro é sinal de
	// que alguém está testando o parser, não de que exportou errado.
	if (formato !== ext) {
		throw new RespostaPublica(
			415,
			MSG.arquivoInvalido,
			`extensão '${ext}' × conteúdo '${formato}'`,
		);
	}

	/* 5. opções do pedido, validadas contra o que o LINK oferece ----------- */
	const materiais = materiaisDoLink(link, await deps.listMateriais(ownerId));
	const materialPedido = textoCurto(campos.material, 80).toLowerCase();
	const material = materiais.find((m) => m.id === materialPedido);
	if (!material) {
		throw new RespostaPublica(
			400,
			MSG.dadosInvalidos,
			`material '${materialPedido}' fora do cardápio`,
		);
	}
	const espessura = num(campos.espessura_mm);
	if (espessura === undefined || !material.espessuras.includes(espessura)) {
		throw new RespostaPublica(
			400,
			MSG.dadosInvalidos,
			`espessura '${campos.espessura_mm}' fora do cardápio`,
		);
	}
	const qtdMax = Math.max(1, Math.min(100_000, num(d.qtd_max) ?? 50));
	const qtd = num(campos.qtd) ?? 1;
	if (!Number.isInteger(qtd) || qtd < 1 || qtd > qtdMax) {
		throw new RespostaPublica(400, MSG.dadosInvalidos, `qtd '${campos.qtd}'`);
	}

	// Lead: quando o link o exige, CONSENTIMENTO É OBRIGATÓRIO, e é conferido
	// aqui — antes de qualquer cálculo ou cobrança. O que vamos guardar é o
	// contato de um TERCEIRO que nunca aceitou nada com a gente (LGPD art. 7º,
	// I): gravar sem o "sim" explícito seria tratamento sem base legal, e
	// gravar depois de já ter cobrado não teria mais volta.
	if (d.pedir_lead === true) {
		const temContato =
			textoCurto(campos.nome, 120) !== '' &&
			textoCurto(campos.whatsapp, 40) !== '';
		if (!temContato || campos.consentimento !== 'true') {
			throw new RespostaPublica(
				400,
				MSG.dadosInvalidos,
				'lead incompleto ou sem consentimento',
			);
		}
	}

	/* 6. cálculo (CPU) ----------------------------------------------------- */
	// O prazo é conferido ENTRE as etapas. Os leitores são síncronos e não têm
	// yield: nenhum sinal os interrompe no meio. Quem segura o pior caso são os
	// tetos agressivos (`MAX_ENTIDADES_PUBLICO`, `MAX_CONTORNOS_PUBLICO`), bem
	// abaixo dos do motor autenticado.
	const signal = AbortSignal.timeout(CPU_BUDGET_MS);
	const texto = entrada.arquivo.toString('utf8');
	const label = entrada.arquivoNome || 'arquivo';
	const sketch =
		formato === 'dxf'
			? readDxf(texto, { maxEntities: MAX_ENTIDADES_PUBLICO, label })
			: readSvg(texto, { maxElements: MAX_ENTIDADES_PUBLICO, label });
	if (prazoEstourado(signal)) {
		throw new RespostaPublica(413, MSG.arquivoGrande, 'prazo no parse');
	}

	const metrics = analyzeGeometry(sketch, {
		maxContours: MAX_CONTORNOS_PUBLICO,
	});
	if (prazoEstourado(signal)) {
		throw new RespostaPublica(413, MSG.arquivoGrande, 'prazo nas métricas');
	}

	// Só os diagnósticos da ALLOWLIST pública (`DIAG_PUBLICOS`), que falam do
	// arquivo do cliente. `peca_maior_que_chapa`, por exemplo, fica de fora: cita
	// a chapa que o profissional compra e a mesa da máquina dele.
	const avisos = diagnose(sketch, metrics, {
		espessura,
		chapa: null,
	})
		.filter((w) => DIAG_PUBLICOS.has(w.code))
		// ARMADILHA MEDIDA POR TESTE: a mensagem de 'entidade_nao_suportada' ecoa
		// os NOMES DAS TAGS do arquivo — string escolhida por quem subiu o arquivo.
		// Sem higienizar, um SVG hostil planta marcação na página do cliente final
		// de outra pessoa. Ver `saneiaTexto`.
		// `publicMessage` quando existe — a `message` fala com o operador ("aumente
		// o furo ou AVISE O CLIENTE"), e aqui quem lê é o cliente.
		.map((w) => saneiaTexto(w.publicMessage ?? w.message));

	/* 7. preço — mesmo motor determinístico da Central de Custos ----------- */
	// Roda COMO O DONO (`customerId: ownerId`): é o perfil de custo, o catálogo
	// de materiais e a base de velocidades DELE que precificam. `toolDoc` vem
	// pronto porque aqui não existe Bearer para falar com o upvox por HTTP.
	const doc = await deps.loadToolDoc();
	const preco = (await quotePriceBlock.run(
		{ customerId: ownerId, signal, toolDoc: doc },
		quotePriceBlock.paramsSchema.parse({
			metrics,
			qtd,
			espessura_mm: espessura,
			material_id: material.id,
			perfil_id: txt(d.perfil_id),
		}),
	)) as { public: OrcamentoPublico };

	// Lemos do `public` do bloco (a saída que a F5 já montou para o cliente
	// final), NÃO de `price_unit_cents`. Diferença que importa: quando o pedido
	// mínimo entra, o unitário de tabela deixa de fechar com o total, e o
	// `orcamentoPublico` já resolve isso publicando o unitário EFETIVO. Usar o
	// número cru entregaria ao cliente um documento onde qtd × unitário ≠ total.
	const pub = preco.public;
	if (pub.pedido_minimo) {
		// O cliente final precisa saber que está no piso da loja — senão a conta
		// dele não fecha e ele acha que foi enganado. O VALOR calculado continua
		// fora: esse é negócio do profissional.
		avisos.push('Este orçamento está no valor mínimo de pedido da oficina.');
	}

	/* 8. teto por LINK ----------------------------------------------------- */
	/* 9. cobrança do DONO (idempotente) ----------------------------------- */
	// Os dois passos vão DENTRO do mesmo cache-aside: no duplo-clique do
	// visitante (mesmo arquivo, mesmas opções) nenhum dos dois roda de novo —
	// nem debita, nem queima a cota diária do dono, nem duplica o lead.
	const chave = idempotencyKey({
		slug,
		fileHash: sha256(entrada.arquivo),
		material: material.id,
		espessuraMm: espessura,
		qtd,
	});

	await deps.cacheAside(
		`q:idem:${chave}`,
		IDEMPOTENCIA_TTL_S,
		async (): Promise<{ invocationId: string }> => {
			const tetoDia = Math.max(1, num(d.teto_dia) ?? TETO_DIA_PADRAO);
			const tetoMes = Math.max(1, num(d.teto_mes) ?? TETO_MES_PADRAO);
			const noDia = await deps.incr(`q:slug:${slug}:d`, JANELA_DIA_S);
			const noMes = await deps.incr(`q:slug:${slug}:m`, JANELA_MES_S);
			if (excedeu(noDia, tetoDia) || excedeu(noMes, tetoMes)) {
				throw new RespostaPublica(
					429,
					MSG.limite,
					`link ${noDia}/${tetoDia} dia, ${noMes}/${tetoMes} mês`,
				);
			}

			const cobranca = await deps.charge({
				customerId: ownerId,
				// PENDÊNCIA DE DEPLOY DECLARADA: o `course_slug` do fluxo autenticado
				// vem do curso em que o aluno está navegando; aqui não há navegação
				// nem aluno. Vem do ambiente, e ERRAR ISSO QUEBRA O LINK EM SILÊNCIO:
				// o upvox devolve 404, que traduzimos para o 402 neutro, e o
				// profissional vê "indisponível" sem nenhuma pista. Confira o valor
				// contra `courses.slug` do upvox antes de publicar.
				courseSlug: process.env.PUBLIC_QUOTE_COURSE_SLUG ?? 'profissao-laser',
				toolKey: 'central_custos',
				idempotencyKey: chave,
			});

			if (cobrancaFalhou(cobranca)) {
				if (cobranca.semSaldo) {
					// E-mail ao DONO fora do caminho da resposta: o visitante não pode
					// esperar o SMTP, e uma falha de e-mail não pode virar erro dele.
					const paraODono = txt(d.email);
					if (paraODono) {
						setImmediate(() => {
							void Promise.resolve(
								deps.avisaDono({
									para: paraODono,
									slug,
									titulo: txt(d.titulo) || link.title || slug,
								}),
							).catch((e) =>
								console.error('[public-quote] aviso ao dono falhou:', e),
							);
						});
					}
				}
				// MENSAGEM NEUTRA, sempre. "O fulano está sem saldo" conta ao cliente
				// final (que pode ser o concorrente) que a empresa está no vermelho.
				throw new RespostaPublica(
					402,
					MSG.indisponivel,
					`cobrança ${cobranca.status}: ${cobranca.detalhe}`,
				);
			}

			/* 10. lead (best-effort) ------------------------------------------ */
			if (d.pedir_lead === true) {
				try {
					await deps.createLead({
						slug,
						ownerId,
						nome: textoCurto(campos.nome, 120),
						whatsapp: textoCurto(campos.whatsapp, 40),
						email: textoCurto(campos.email, 160),
						empresa: textoCurto(campos.empresa, 120),
						ipHash: entrada.ipHash,
						precoTotalCents: pub.total_cents,
						arquivoNome: entrada.arquivoNome,
						consentimento: campos.consentimento === 'true',
					});
				} catch (e) {
					// O orçamento JÁ FOI COBRADO. Perder o lead é ruim; devolver erro
					// depois de debitar o dono é pior.
					console.error('[public-quote] lead não gravado:', e);
				}
			}
			return { invocationId: cobranca.invocationId };
		},
	);

	/* 11. resposta pública, montada do zero -------------------------------- */
	return montaResposta({
		precoUnitCents: pub.preco_unitario_cents,
		precoTotalCents: pub.total_cents,
		qtd,
		...(d.mostrar_prazo === true ? { prazoDias: pub.prazo_dias } : {}),
		metrics,
		resumo: `${material.nome} ${espessura} mm · ${qtd} un · ${r3(metrics.bbox.w)} × ${r3(metrics.bbox.h)} mm`,
		avisos,
		// Vem do `public` do bloco, que já é a saída pensada para o cliente final.
		estimativa: pub.estimativa === true,
		// Idem: `orcamentoPublico` já zera o desconto quando o pedido mínimo entra
		// (aí o unitário publicado é o efetivo e a conta fecha sem ele).
		descontoPct: pub.desconto_pct,
	});
}

/** `-1` = fail-open do Redis (sem teto). Qualquer outro valor obedece o teto. */
function excedeu(contador: number, teto: number): boolean {
	return contador > 0 && contador > teto;
}

/**
 * Teto por IP — conferido ANTES DE LER O CORPO DA REQUISIÇÃO.
 *
 * A posição é a defesa. Se o teto ficasse depois do multipart, um atacante
 * mandaria 8 MB por requisição indefinidamente só variando um campo inválido:
 * cada tentativa seria rejeitada "de graça" em CPU, mas teria consumido banda e
 * memória do processo. Aqui basta o endereço da conexão — que já se conhece
 * antes do primeiro byte de corpo — para dizer não.
 *
 * O preço dessa escolha, assumido: um visitante legítimo que erre o formulário
 * seis vezes numa hora também é barrado. Como os campos vêm de listas fechadas
 * (material e espessura são `select`), errar seis vezes exige tentar de
 * propósito.
 */
export async function tetoIpExcedido(
	ipHash: string,
	deps: PublicQuoteDeps,
): Promise<boolean> {
	const hora = await deps.incr(`q:ip:${ipHash}:h`, JANELA_HORA_S);
	const dia = await deps.incr(`q:ip:${ipHash}:d`, JANELA_DIA_S);
	const estourou = excedeu(hora, IP_POR_HORA) || excedeu(dia, IP_POR_DIA);
	if (estourou) {
		console.warn(`[public-quote] 429 teto por IP (${hora}/h, ${dia}/dia)`);
	}
	return estourou;
}

/* ─────────────────────── Multipart: leitura limitada ─────────────────────── */

/**
 * Lê o multipart COM LIMITES POR REQUEST.
 *
 * ISTO NÃO É OPCIONAL: `src/server.ts` registra o multipart globalmente com
 * 1,5 GB (o painel do admin sobe vídeo). Sem o override aqui, a primeira rota
 * sem autenticação do sistema aceitaria upload de 1,5 GB de qualquer pessoa da
 * internet — derrubar a API custaria uma linha de `curl`.
 */
async function lePartes(request: FastifyRequest): Promise<{
	campos: Record<string, string>;
	arquivo: Buffer | null;
	arquivoNome: string;
}> {
	const campos: Record<string, string> = {};
	let arquivo: Buffer | null = null;
	let arquivoNome = '';

	const partes = request.parts({
		limits: {
			fileSize: MAX_UPLOAD_BYTES,
			files: MAX_FILES,
			fields: MAX_FIELDS,
			fieldSize: MAX_FIELD_BYTES,
		},
	});

	for await (const parte of partes) {
		if (parte.type === 'file') {
			// Só o PRIMEIRO arquivo. `files: 1` já derruba o segundo, mas a guarda
			// aqui garante que uma mudança de versão do multipart não nos surpreenda.
			if (arquivo) continue;
			arquivo = await parte.toBuffer();
			arquivoNome = nomeArquivoSeguro(parte.filename);
		} else {
			campos[parte.fieldname] = textoCurto(parte.value, MAX_FIELD_BYTES);
		}
	}
	return { campos, arquivo, arquivoNome };
}

/** Erro do multipart → status. Os códigos `FST_*` já trazem o status certo. */
function statusDoMultipart(err: unknown): { status: number; message: string } {
	const e = err as { code?: string; statusCode?: number };
	if (typeof e?.code === 'string' && e.code.startsWith('FST_')) {
		if (e.statusCode === 413) {
			return { status: 413, message: MSG.arquivoGrande };
		}
		if (e.statusCode === 406) {
			return { status: 415, message: MSG.arquivoInvalido };
		}
		return { status: 400, message: MSG.dadosInvalidos };
	}
	return { status: 400, message: MSG.dadosInvalidos };
}

/* ─────────────────────────── Controllers Fastify ─────────────────────────── */

export function makePublicQuoteControllers(deps: PublicQuoteDeps) {
	return {
		info: async (request: FastifyRequest, reply: FastifyReply) => {
			const { slug } = request.params as { slug?: string };
			try {
				return reply.status(200).send(await infoDoLink(slug, deps));
			} catch (err) {
				if (err instanceof RespostaPublica) {
					return reply.status(err.status).send({ message: err.mensagem });
				}
				console.error('[public-quote] info falhou:', err);
				return reply.status(500).send({ message: MSG.indisponivel });
			}
		},

		estimate: async (request: FastifyRequest, reply: FastifyReply) => {
			const { slug } = request.params as { slug?: string };
			const ipHash = hashIp(clientIp(request));

			// Primeiro de tudo, antes até de ler o corpo: ver `tetoIpExcedido`.
			if (await tetoIpExcedido(ipHash, deps)) {
				return reply.status(429).send({ message: MSG.limite });
			}

			let lido: Awaited<ReturnType<typeof lePartes>>;
			try {
				lido = await lePartes(request);
			} catch (err) {
				const { status, message } = statusDoMultipart(err);
				return reply.status(status).send({ message });
			}

			const { status, body } = await estimarOrcamento(
				{
					slug,
					campos: lido.campos,
					arquivo: lido.arquivo,
					arquivoNome: lido.arquivoNome,
					ipHash,
				},
				deps,
			);
			return reply.status(status).send(body);
		},
	};
}

/**
 * Dependências reais, montadas SOB DEMANDA. Import dinâmico de propósito:
 * `repositories/*` e `lib/mailer` validam variáveis de ambiente no topo do
 * módulo, e este arquivo é importado pelos testes.
 */
let reais: PublicQuoteDeps | null = null;

export async function realPublicQuoteDeps(): Promise<PublicQuoteDeps> {
	if (reais) return reais;
	const [repo, redis, upvox, mailer] = await Promise.all([
		import('../repositories/public-quote.js'),
		import('../lib/redis.js'),
		import('../lib/upvox-internal.js'),
		import('../lib/mailer.js'),
	]);
	reais = {
		findLink: repo.findLinkBySlug,
		linkAtivo: repo.linkAtivo,
		listMateriais: (ownerId) => repo.listMateriais(ownerId),
		findMarca: (ownerId) => repo.findMarca(ownerId),
		loadToolDoc: () => repo.loadToolDocDirect(),
		createLead: repo.createLead,
		charge: upvox.chargeToolOwner,
		incr: redis.incrWithTtl,
		cacheAside: (key, ttl, fn) => redis.cache.cacheAside(key, ttl, fn),
		avisaDono: (input) =>
			mailer.sendOrcamentoIndisponivelEmail({
				to: input.para,
				slug: input.slug,
				titulo: input.titulo,
			}),
		agora: () => Date.now(),
	};
	return reais;
}

export const publicQuoteInfoController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) =>
	makePublicQuoteControllers(await realPublicQuoteDeps()).info(request, reply);

export const publicQuoteEstimateController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) =>
	makePublicQuoteControllers(await realPublicQuoteDeps()).estimate(
		request,
		reply,
	);
