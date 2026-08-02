import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from 'node:crypto';

/**
 * LINK PÚBLICO DE ORÇAMENTO — as defesas, isoladas do controller.
 *
 * Esta é a PRIMEIRA rota do sistema que aceita upload de arquivo SEM
 * autenticação e que gasta o dinheiro (voxxys) de um TERCEIRO — o profissional
 * dono do link. As duas coisas juntas mudam o modelo de ameaça:
 *
 *   • quem sobe o arquivo não tem conta, não tem histórico e não tem nada a
 *     perder; o único custo do ataque é largura de banda;
 *   • quem PAGA a conta não está na requisição e não fica sabendo que ela
 *     aconteceu — logo, todo teto tem que ser imposto aqui, do lado do servidor.
 *
 * Por isso tudo neste módulo é conservador por padrão e falha para o lado de
 * NÃO gastar. As funções são puras (só built-ins + `process.env` lido DENTRO da
 * função, nunca no topo) para poderem ser testadas sem subir servidor.
 */

/* ────────────────────────────── Limites ────────────────────────────── */

/**
 * Teto do upload NESTA rota. O multipart é registrado GLOBALMENTE com 1,5 GB
 * (`src/server.ts`) porque o painel do admin sobe vídeo; sem o override por
 * request, o link público publicaria um upload de 1,5 GB sem login — o ataque
 * mais barato do mundo contra a API inteira.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Um arquivo por orçamento. Mais de um é abuso, não engano. */
export const MAX_FILES = 1;

/** Campos do formulário (slug, nonce, material, espessura, qtd, lead…). */
export const MAX_FIELDS = 12;

/**
 * Teto do VALOR de cada campo. Não está no enunciado, mas sem ele `fields: 12`
 * ainda deixa passar 12 × 1 MB (default do busboy) de texto — 12 MB por request
 * sem login. O maior campo legítimo aqui é o nonce (~120 chars).
 */
export const MAX_FIELD_BYTES = 8 * 1024;

/**
 * Orçamento de CPU do request inteiro, em ms.
 *
 * ATENÇÃO — HONESTIDADE SOBRE O QUE ISTO PROTEGE: `readDxf`, `readSvg` e
 * `analyzeGeometry` são SÍNCRONOS e não têm ponto de yield. Nenhum
 * `AbortSignal` interrompe código síncrono no Node: o event loop só volta
 * quando a função retorna. Portanto o sinal só é checado ENTRE as etapas e
 * serve para não ENCADEAR mais trabalho depois de estourar o prazo.
 *
 * Quem realmente segura o pior caso são os TETOS AGRESSIVOS abaixo, bem
 * menores que os do motor autenticado. Este é um Fastify sem worker thread:
 * um DXF pesado nesta rota trava o processo inteiro, inclusive o checkout.
 */
export const CPU_BUDGET_MS = 12_000;

/** Teto de entidades/elementos do leitor NESTA rota (motor autenticado: 100k). */
export const MAX_ENTIDADES_PUBLICO = 20_000;

/** Teto de contornos da topologia NESTA rota (motor autenticado: 20k). */
export const MAX_CONTORNOS_PUBLICO = 4_000;

/* ─────────────────────────── Flood (Redis) ─────────────────────────── */

/** Requisições por IP por hora. */
export const IP_POR_HORA = 6;
/** Requisições por IP por dia. */
export const IP_POR_DIA = 20;
/** Teto diário por link quando o dono não configurou. */
export const TETO_DIA_PADRAO = 30;
/** Teto mensal por link quando o dono não configurou. */
export const TETO_MES_PADRAO = 300;

export const JANELA_HORA_S = 60 * 60;
export const JANELA_DIA_S = 24 * 60 * 60;
export const JANELA_MES_S = 30 * 24 * 60 * 60;

/** TTL da chave de idempotência da cobrança (duplo-clique do visitante). */
export const IDEMPOTENCIA_TTL_S = 10 * 60;

/* ──────────────────────────── Bot / nonce ──────────────────────────── */

/**
 * Campo escondido do formulário. Humano nunca preenche (está fora da tela);
 * robô de formulário preenche tudo que encontra. Preenchido → 200 vazio, SEM
 * cobrar — o robô acha que funcionou e não tenta de novo.
 */
export const HONEYPOT_FIELD = 'website';

/** Validade do nonce emitido no GET. */
export const NONCE_TTL_MS = 30 * 60 * 1000;

/**
 * Tempo mínimo entre o GET e o POST. Ninguém escolhe arquivo, material,
 * espessura e quantidade em menos de 3 segundos; script preenche em 50 ms.
 */
export const NONCE_MIN_AGE_MS = 3_000;

/**
 * Segredo do HMAC do nonce e pimenta do hash de IP.
 *
 * ARMADILHA DE DEPLOY: com vários processos/instâncias atrás de um load
 * balancer, o nonce é emitido por uma instância e conferido por OUTRA. Um
 * segredo aleatório por processo faria todo POST cair em "nonce inválido" de
 * forma intermitente e impossível de reproduzir. Por isso a cadeia de fallback
 * termina num valor aleatório APENAS como último recurso, e com aviso no log:
 * em produção, configure `PUBLIC_QUOTE_SECRET` (ou tenha `INTERNAL_API_SECRET`,
 * que esta feature já exige para cobrar).
 */
let segredoEfemero: string | null = null;
let avisouSegredo = false;

function segredo(): string {
	const fixo =
		process.env.PUBLIC_QUOTE_SECRET ?? process.env.INTERNAL_API_SECRET ?? '';
	if (fixo.length >= 16) return fixo;
	if (!segredoEfemero) {
		segredoEfemero = randomBytes(32).toString('hex');
		if (!avisouSegredo) {
			avisouSegredo = true;
			console.warn(
				'[public-quote] PUBLIC_QUOTE_SECRET/INTERNAL_API_SECRET ausentes: nonce assinado com segredo EFÊMERO. Com mais de uma instância, o POST vai falhar de forma intermitente.',
			);
		}
	}
	return segredoEfemero;
}

/** Pimenta do hash de IP. Separada do segredo do nonce quando configurada. */
function pimenta(): string {
	return process.env.PUBLIC_QUOTE_IP_PEPPER ?? segredo();
}

function b64url(buf: Buffer): string {
	return buf.toString('base64url');
}

function assina(slug: string, emitidoEm: number, aleatorio: string): string {
	return b64url(
		createHmac('sha256', segredo())
			.update(`${slug}|${emitidoEm}|${aleatorio}`)
			.digest(),
	);
}

/**
 * Emite o nonce do GET. Formato `<emitidoEm>.<aleatorio>.<assinatura>`.
 *
 * O timestamp vai EM CLARO de propósito e está DENTRO da assinatura: é ele que
 * dá TTL e idade mínima sem precisar guardar estado nenhum (o link público não
 * pode depender de sessão — não há sessão). Como está assinado junto com o
 * slug, adiantar o relógio do token ou reusá-lo em outro link quebra o HMAC.
 */
export function issueNonce(slug: string, agora = Date.now()): string {
	const aleatorio = randomBytes(9).toString('base64url');
	return `${agora}.${aleatorio}.${assina(slug, agora, aleatorio)}`;
}

export type NonceFalha =
	| 'ausente'
	| 'malformado'
	| 'assinatura'
	| 'expirado'
	| 'rapido_demais';

export interface NonceOk {
	ok: true;
	emitidoEm: number;
}
export interface NonceErro {
	ok: false;
	motivo: NonceFalha;
}
export type NonceResultado = NonceOk | NonceErro;

/**
 * Guarda explícita em vez de `if (!r.ok)`.
 *
 * O `tsconfig` deste repo NÃO liga `strict`, e sem `strictNullChecks` o
 * TypeScript não estreita união discriminada por booleano literal — `r.motivo`
 * viraria erro de compilação dentro do `if`. Um type guard nomeado funciona nos
 * dois modos e deixa a intenção explícita.
 */
export function nonceFalhou(r: NonceResultado): r is NonceErro {
	return r.ok !== true;
}

/**
 * Confere o nonce. O motivo NUNCA vai para o visitante — serve para log e
 * para o teste. Dizer "expirado" para um robô é ensiná-lo a renovar.
 */
export function verifyNonce(
	slug: string,
	token: string | undefined | null,
	agora = Date.now(),
): NonceResultado {
	if (!token) return { ok: false, motivo: 'ausente' };
	const partes = token.split('.');
	if (partes.length !== 3) return { ok: false, motivo: 'malformado' };

	const [emitidoTxt, aleatorio, assinatura] = partes;
	const emitidoEm = Number(emitidoTxt);
	if (!Number.isSafeInteger(emitidoEm) || emitidoEm <= 0) {
		return { ok: false, motivo: 'malformado' };
	}

	// Assinatura ANTES do relógio: só depois de saber que o token é nosso é que
	// vale a pena falar de tempo (e o comparador é timing-safe).
	const esperada = Buffer.from(assina(slug, emitidoEm, aleatorio));
	const recebida = Buffer.from(assinatura);
	if (
		esperada.length !== recebida.length ||
		!timingSafeEqual(esperada, recebida)
	) {
		return { ok: false, motivo: 'assinatura' };
	}

	const idade = agora - emitidoEm;
	// Idade negativa = token do "futuro". Só acontece com relógio torto entre
	// instâncias; tratamos como rápido demais (é o lado seguro).
	if (idade < NONCE_MIN_AGE_MS) return { ok: false, motivo: 'rapido_demais' };
	if (idade > NONCE_TTL_MS) return { ok: false, motivo: 'expirado' };
	return { ok: true, emitidoEm };
}

/* ─────────────────────────────── IP (LGPD) ─────────────────────────────── */

/**
 * IP do visitante.
 *
 * NÃO lemos `x-forwarded-for` à mão — de propósito, e este é o ponto:
 *
 *   • `request.ip` do Fastify JÁ É a regra pedida. Com `trustProxy` ligado ele
 *     resolve a cadeia de `x-forwarded-for`; SEM `trustProxy` ele devolve o
 *     endereço do socket e ignora o header. Ler o header por conta própria só
 *     poderia piorar isso: o header é texto livre que qualquer cliente escreve,
 *     e um teto por IP baseado nele viraria enfeite (basta variar a cada
 *     requisição).
 *
 *   • ARMADILHA MEDIDA: `app.initialConfig` do Fastify 5 NÃO expõe
 *     `trustProxy` (a lista de chaves publicadas é curada e não o inclui). Ou
 *     seja, não dá para "conferir se confia" em tempo de execução — a única
 *     fonte correta é o próprio `request.ip`.
 *
 * Hoje `src/server.ts` sobe SEM `trustProxy`, então atrás de um proxy todos os
 * visitantes compartilham o mesmo IP e o teto por IP fica conservador demais
 * (e, no limite, inútil). Quem segura o custo nesse cenário é o TETO POR LINK.
 */
export function clientIp(req: {
	ip?: string;
	socket?: { remoteAddress?: string | undefined };
}): string {
	if (typeof req.ip === 'string' && req.ip) return req.ip;
	return req.socket?.remoteAddress ?? '0.0.0.0';
}

/**
 * Guardamos `sha256(ip + pimenta)`, nunca o IP.
 *
 * IP é dado pessoal (LGPD art. 5º, I): o lead do cliente final do profissional
 * fica no nosso banco por tempo indeterminado, e ninguém precisa do endereço —
 * o que precisamos é só saber que DUAS requisições vieram do mesmo lugar. Com a
 * pimenta, nem quem lê a tabela consegue rodar o dicionário dos 4 bilhões de
 * IPv4 para descobrir qual era.
 */
export function hashIp(ip: string): string {
	return createHash('sha256').update(`${ip}${pimenta()}`).digest('hex');
}

/* ──────────────────────────── Idempotência ──────────────────────────── */

export function sha256(buf: Buffer | string): string {
	return createHash('sha256').update(buf).digest('hex');
}

/**
 * Chave de idempotência da COBRANÇA. Duplo-clique do visitante (ou retry do
 * navegador em rede ruim) manda exatamente o mesmo arquivo e as mesmas opções —
 * e não pode debitar duas vezes do dono. Entra o conteúdo do arquivo, não o
 * nome: renomear não muda o orçamento.
 */
export function idempotencyKey(input: {
	slug: string;
	fileHash: string;
	material: string;
	espessuraMm: number;
	qtd: number;
}): string {
	return sha256(
		[
			input.slug,
			input.fileHash,
			input.material,
			input.espessuraMm,
			input.qtd,
		].join('|'),
	);
}

/* ───────────────────────────── Slug / texto ───────────────────────────── */

/** Slug do link: vira chave de Redis e filtro de coleção — formato fechado. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

export function slugValido(slug: unknown): slug is string {
	return typeof slug === 'string' && SLUG_RE.test(slug);
}

/** Caracteres de controle (inclusive NUL e DEL) — fora de tudo que o visitante manda. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: são exatamente estes os caracteres que se quer remover do que o visitante manda
const CONTROLE_RE = /[\u0000-\u001f\u007f]/g;

/**
 * Nome de arquivo higienizado antes de guardar/logar. O visitante escolhe esta
 * string: sem caminho (`../`), sem caractere de controle e com teto de tamanho.
 */
export function nomeArquivoSeguro(nome: string | undefined | null): string {
	const base = (nome ?? '').split(/[\\/]/).pop() ?? '';
	return base.replace(CONTROLE_RE, '').slice(0, 200);
}

/** Texto curto vindo do visitante (nome, empresa, whatsapp…). */
export function textoCurto(v: unknown, max = 120): string {
	if (typeof v !== 'string') return '';
	return v.replace(CONTROLE_RE, '').trim().slice(0, max);
}

/**
 * Texto que vai APARECER na página do cliente final, higienizado.
 *
 * ACHADO REAL, encontrado pelo teste do SVG hostil: os diagnósticos do leitor
 * ECOAM o conteúdo do arquivo. `readSvg` conta as tags ignoradas com
 * `bump(ignoradas, '<' + nome + '>')`, onde `nome` é o nome da tag COMO VEIO
 * NO ARQUIVO — string escolhida pelo atacante. Isso desaguava no aviso
 * "entidade(s) não suportada(s) (<script>×1, <img src=x onerror=…>×1)", que a
 * tela do link renderiza. Num fluxo autenticado é um detalhe; aqui é conteúdo
 * de terceiro anônimo indo parar na página do CLIENTE de outra pessoa, no
 * nosso domínio.
 *
 * A correção fica NA FRONTEIRA e não em `lib/cad`: para o profissional, ver
 * `<script>` no relatório é informação legítima ("seu arquivo tem lixo"). O que
 * não pode é essa string sair sem tratamento na rota pública. Tiramos os
 * caracteres com que se monta marcação e limitamos o tamanho — a mensagem
 * continua legível ("script×1") e fica inerte em HTML, em atributo e em JSON.
 */
export function saneiaTexto(s: unknown, max = 400): string {
	if (typeof s !== 'string') return '';
	return s
		.replace(CONTROLE_RE, ' ')
		.replace(/[<>"'`\\]/g, '')
		.replace(/\s{2,}/g, ' ')
		.trim()
		.slice(0, max);
}

/**
 * URL que a página pública vai carregar (logo do profissional).
 *
 * ALLOWLIST de esquema: `javascript:` e `data:text/html` num `src`/`href` são
 * execução de código na página do cliente final. O dono do link escolhe este
 * valor — e a página é servida no NOSSO domínio, para visitantes que não são
 * ele. Valor fora da allowlist vira string vazia (a tela mostra sem logo).
 */
export function saneiaUrl(s: unknown): string {
	if (typeof s !== 'string') return '';
	const limpo = s.replace(CONTROLE_RE, '').trim().slice(0, 2000);
	if (/^https?:\/\/[^\s<>"']+$/i.test(limpo)) return limpo;
	// `svg+xml` fica DE FORA mesmo em data URL: um SVG é documento executável, e
	// basta a tela trocar o `<img>` por `<object>`/`<iframe>` um dia para virar
	// execução de script. Logo é bitmap.
	if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[\w+/=]+$/i.test(limpo)) {
		return limpo;
	}
	return '';
}

/** Lista "a|b, c" → ['a','b','c'] em minúsculas. Aceita as três separações. */
export function listaDeTexto(v: unknown): string[] {
	if (typeof v !== 'string' || !v.trim()) return [];
	return v
		.split(/[|,;\n]/)
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

/** Lista numérica ("3|6|9,12") → [3,6,9,12] ordenada e sem repetição. */
export function listaDeNumeros(v: unknown): number[] {
	const nums = listaDeTexto(v)
		.map((s) => Number(s.replace(',', '.')))
		.filter((n) => Number.isFinite(n) && n > 0);
	return [...new Set(nums)].sort((a, b) => a - b);
}

/* ────────────────────────── Mensagens neutras ────────────────────────── */

/**
 * O visitante NUNCA pode aprender nada sobre a conta do profissional. "Sem
 * saldo" conta ao concorrente que a empresa está no vermelho e ao curioso que
 * existe um saldo para esgotar; "limite diário atingido" conta quantos
 * orçamentos ele recebe. Todas as saídas de erro deste fluxo passam por aqui.
 */
export const MSG = {
	indisponivel: 'orcamento_indisponivel',
	limite: 'limite_atingido',
	arquivoGrande: 'arquivo_grande_demais',
	arquivoInvalido: 'arquivo_invalido',
	sessaoExpirada: 'sessao_expirada',
	linkInvalido: 'link_invalido',
	dadosInvalidos: 'dados_invalidos',
} as const;

/* ──────────────────────────── Prazo (CPU) ──────────────────────────── */

/** Estourou o orçamento de CPU? Checado ENTRE etapas (ver `CPU_BUDGET_MS`). */
export function prazoEstourado(signal: AbortSignal | undefined): boolean {
	return Boolean(signal?.aborted);
}
