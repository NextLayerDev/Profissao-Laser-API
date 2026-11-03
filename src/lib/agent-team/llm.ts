import { openrouter } from '../openrouter.js';
import {
	findTextModel,
	TEXT_MODELS_CATALOG,
	type TextModelEntry,
} from '../text-models-catalog.js';
import { imagemParaDataUrl, LADO_PADRAO } from './imagem.js';

/**
 * A CHAMADA DE UM ESPECIALISTA AO MODELO — texto, foto e (opcionalmente) busca.
 *
 * Não é vendor novo nem contrato novo: é a mesma chave do OpenRouter, com o
 * campo `plugins` que a API já aceita quando há busca. Busca custa US$ 0,005
 * por chamada.
 *
 * ┌─ O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR ────────────────────────────────┐
 * │ Medido ao vivo em 2026-08-03, 3 tentativas por modelo: os DOIS DeepSeek │
 * │ devolvem `content: ""` com as `annotations` de citação PREENCHIDAS. Ou   │
 * │ seja: a busca é cobrada e o texto não vem — e um `?? ''` inocente lá     │
 * │ atrás transformaria isso em "pesquisa concluída, nada encontrado".       │
 * │ Aqui, resposta vazia é ERRO EXPLÍCITO com o nome do modelo e com o que a │
 * │ chamada JÁ CUSTOU.                                                       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE ISTO SAIU DE `lib/research/search.ts` ─────────────────────────┐
 * │ Porque nada aqui é sobre PESQUISA: é sobre chamar um modelo e saber o    │
 * │ que a chamada custou. O time do Ateliê precisa exatamente disto, com     │
 * │ FOTO junto (a do produto, as dos anúncios de referência) e sem busca     │
 * │ nenhuma. A alternativa era uma segunda cópia da guarda de resposta       │
 * │ vazia, do mapa de erros e da contabilidade de `usage.cost` — as três     │
 * │ coisas que o parágrafo acima diz que este arquivo existe para proteger.  │
 * │                                                                          │
 * │ O que FICOU em `search.ts` é o que só a Central usa: `filtrarPorTema`,   │
 * │ que descarta citação fora do tema pelas palavras-chave da categoria.     │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/** Motores de busca aceitos. `native` fica FORA: dá 404 fora de Anthropic/Google/OpenAI/Perplexity/xAI. */
export type SearchEngine = 'exa' | 'perplexity';

export interface Citation {
	url: string;
	title?: string;
	/** Trecho da página. É daqui que sai preço e "+50 vendidos". */
	content?: string;
}

export interface ChamadaResult {
	/** Qual modelo de fato respondeu (o chamador pode ter feito retry). */
	modelUsado: string;
	text: string;
	citations: Citation[];
	/** Tokens, para o custo. */
	usage: { in: number; out: number };
	/** Quantas buscas o provedor cobrou nesta chamada. */
	buscas: number;
	custoUsd: number;
}

/**
 * O QUE O ALUNO LÊ QUANDO UM ESPECIALISTA NÃO ENTREGA.
 *
 * ┌─ A REGRA: a tela do aluno não fala de máquina ───────────────────────────┐
 * │ `message` existe para o log e para o diagnóstico, e é técnica de         │
 * │ propósito — sem "(500)" e sem o id do modelo não dá para consertar nada. │
 * │ Só que ela viajava INTEIRA até o cartão do especialista na sala de       │
 * │ guerra: "falha na chamada (500)", "erro do provedor" e, o pior de todos, │
 * │ "o modelo 'google/gemini-3.1-flash-lite' devolveu resposta vazia (mas    │
 * │ cobrou 3 resultado(s) de busca)" — nome de modelo E cobrança na tela de  │
 * │ quem comprou "um time de profissionais". A do JSON quebrado dizia "a     │
 * │ resposta bateu no limite de tokens e veio cortada (18.240 caracteres,    │
 * │ teto 3400 tokens)".                                                      │
 * │                                                                          │
 * │ Então são DOIS textos, e não um sanitizado: o técnico continua inteiro   │
 * │ no `message` (log, `budget.diagnosticos`), e o `paraTela` é uma frase de │
 * │ português sobre o TRABALHO que não saiu. Filtrar por regex a caminho da  │
 * │ tela seria apostar que nenhuma mensagem futura inventa um jeito novo de  │
 * │ falar de máquina — e quem escreve mensagem de erro não lembra da regra.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const FALHA_PARA_TELA: Record<ChamadaError['kind'], string> = {
	vazio: 'não trouxe o levantamento dele desta vez.',
	timeout: 'demorou mais que o combinado e não deu tempo de esperar.',
	rate: 'não conseguiu vez para pesquisar agora.',
	falha: 'não conseguiu concluir esta parte do trabalho.',
};

export class ChamadaError extends Error {
	constructor(
		message: string,
		readonly kind: 'vazio' | 'timeout' | 'rate' | 'falha',
		/**
		 * O que esta chamada JÁ CUSTOU antes de falhar.
		 *
		 * Existe porque o modo de falha mais caro de um time é justamente o que não
		 * devolve resposta: o modelo gera a saída inteira (ou a busca é cobrada) e
		 * o texto não chega utilizável. Sem carregar o gasto no erro, quem
		 * contabiliza só vê as chamadas que deram certo — e o `custo_usd` gravado
		 * na entrega esconde exatamente os runs caros, que é o número que a gente
		 * usaria para conferir a margem.
		 */
		readonly gasto?: { buscas: number; custoUsd: number },
		/**
		 * A frase que o ALUNO lê, quando a do `kind` não é específica o bastante.
		 * Ver `FALHA_PARA_TELA`. Nunca cite modelo, token, status HTTP nem preço.
		 */
		readonly paraTela?: string,
	) {
		super(message);
		this.name = 'ChamadaError';
	}

	/** O que vai para a tela: nunca o `message`. */
	get mensagemParaTela(): string {
		return this.paraTela ?? FALHA_PARA_TELA[this.kind];
	}
}

/** Preço por requisição de busca (exa e perplexity cobram igual hoje). */
export const USD_POR_BUSCA = 0.005;

export interface ChamadaOpts {
	model: TextModelEntry;
	system: string;
	user: string;
	/**
	 * AS FOTOS que este especialista tem que OLHAR.
	 *
	 * Vazio na Central (ninguém lá enxerga nada) e é por isso que o parâmetro é
	 * opcional: sem imagem, o corpo da requisição sai EXATAMENTE como saía antes
	 * deste campo existir — `content` string, não lista de partes.
	 *
	 * Cada foto entra reduzida (ver `imagem.ts`) e vale ~1.500 tokens de
	 * entrada. Quem projeta o custo tem que somar isso ANTES de autorizar a
	 * chamada, senão o freio de gasto não conhece o item mais caro do prompt.
	 */
	imagens?: Buffer[];
	/** Lado máximo de cada foto. Ver `LADO_PADRAO`. */
	maxSide?: number;
	engine: SearchEngine | 'nenhum';
	maxResults: number;
	includeDomains?: string[];
	excludeDomains?: string[];
	maxTokens: number;
	temperature: number;
	json: boolean;
	signal: AbortSignal;
	/** Rótulo do produto no painel do OpenRouter. */
	titulo?: string;
	/**
	 * DESLIGA O RACIOCÍNIO DO MODELO — e isto conserta um run que MORRIA.
	 *
	 * ┌─ O DEFEITO, MEDIDO ─────────────────────────────────────────────────────┐
	 * │ Modelo que raciocina antes de escrever cobra o raciocínio COMO SAÍDA e   │
	 * │ o gasta ANTES da primeira chave do JSON. O `prompt_final` do Ateliê      │
	 * │ (Sonnet, teto 4.000 = `MAX_TOKENS_TETO`) truncava em 3 de 3 chamadas com │
	 * │ digest cheio: `finish_reason: 'length'`, JSON pela metade, run perdido — │
	 * │ é o "A arte não saiu desta vez" que o aluno via.                          │
	 * │                                                                          │
	 * │ Três chamadas reais, mesmo digest, mesmo modelo:                         │
	 * │   com raciocínio ......... 4.579–7.040 tokens · US$ 0,058–0,083 · TRUNCA │
	 * │   `effort:'low'` ......... 1.769–1.921 tokens · US$ 0,030 · fecha        │
	 * │   `enabled:false` ........ 1.740–1.787 tokens · US$ 0,030 · fecha        │
	 * │                                                                          │
	 * │ E o prompt entregue é EQUIVALENTE: 437, 568 e 495 palavras, mesma        │
	 * │ estrutura e mesmo nível de detalhe. Ou seja, o raciocínio custava o dobro │
	 * │ e derrubava o run sem melhorar a arte.                                   │
	 * │                                                                          │
	 * │ ⚠ `reasoning:{max_tokens:1024}` é ARMADILHA: medido, foi para 16.000     │
	 * │ tokens e US$ 0,17, PIOR que não mexer. Só `effort` e `enabled` servem.   │
	 * └─────────────────────────────────────────────────────────────────────────┘
	 *
	 * Ausente = o modelo decide (comportamento de sempre, para quem não declarou).
	 */
	raciocinio?: 'padrao' | 'baixo' | 'desligado';
}

/** Lista CSV do admin → array limpo. */
export function parseDominios(raw: unknown): string[] {
	if (typeof raw !== 'string' || !raw.trim()) return [];
	return raw
		.split(',')
		.map((s) =>
			s
				.trim()
				.replace(/^https?:\/\//, '')
				.replace(/\/.*$/, ''),
		)
		.filter(Boolean)
		.slice(0, 10);
}

/**
 * Monta o `plugins` da requisição.
 *
 * REGRA MEDIDA, não opinião: `include_domains` só vale com `perplexity`. Com
 * `exa` (que é busca semântica por embedding) restringir domínio destrói a
 * relevância — no teste, buscar "placa de PIX" restrito ao Mercado Livre
 * devolveu cooler de PC e placa wi-fi. Se vier `include_domains` num agente de
 * `exa`, o filtro é IGNORADO e o motivo fica registrado.
 */
export function montarPlugin(o: {
	engine: SearchEngine;
	maxResults: number;
	includeDomains?: string[];
	excludeDomains?: string[];
}): { plugin: Record<string, unknown>; aviso?: string } {
	const plugin: Record<string, unknown> = {
		id: 'web',
		engine: o.engine,
		max_results: Math.max(1, Math.min(10, o.maxResults)),
	};
	let aviso: string | undefined;

	if (o.includeDomains?.length) {
		if (o.engine === 'perplexity') {
			plugin.include_domains = o.includeDomains;
		} else {
			aviso = `filtro de domínio ignorado: com o motor '${o.engine}' ele degrada a relevância (medido). Use 'perplexity' para mirar marketplace.`;
		}
	}
	if (o.excludeDomains?.length) plugin.exclude_domains = o.excludeDomains;

	return { plugin, aviso };
}

/** Extrai as citações do formato `annotations[].url_citation`. */
export function extrairCitacoes(message: unknown): Citation[] {
	const anns = (message as { annotations?: unknown[] } | null)?.annotations;
	if (!Array.isArray(anns)) return [];
	const out: Citation[] = [];
	for (const a of anns) {
		const c = (a as { url_citation?: Citation } | null)?.url_citation;
		if (c && typeof c.url === 'string') {
			out.push({ url: c.url, title: c.title, content: c.content });
		}
	}
	return out;
}

/** Parte de conteúdo no formato multimodal da API compatível com OpenAI. */
type Parte =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } };

/**
 * O conteúdo da mensagem do usuário.
 *
 * SEM FOTO devolve a STRING, e isso não é preciosismo: é o que garante que a
 * Central — que nunca manda foto — continue emitindo o mesmo corpo de
 * requisição de sempre, byte a byte. Com foto, vira a lista de partes, com o
 * texto ANTES das imagens (é a ordem que os provedores documentam e a que faz o
 * modelo ler a pergunta antes de olhar).
 */
async function montarConteudo(
	user: string,
	imagens: Buffer[],
	maxSide: number,
): Promise<string | Parte[]> {
	if (imagens.length === 0) return user;
	const partes: Parte[] = [{ type: 'text', text: user }];
	for (const buf of imagens) {
		partes.push({
			type: 'image_url',
			image_url: { url: await imagemParaDataUrl(buf, maxSide) },
		});
	}
	return partes;
}

export async function chamarModelo(o: ChamadaOpts): Promise<ChamadaResult> {
	const imagens = (o.imagens ?? []).filter(
		(b) => Buffer.isBuffer(b) && b.length,
	);
	const conteudo = await montarConteudo(
		o.user,
		imagens,
		o.maxSide ?? LADO_PADRAO,
	);

	const messages: { role: 'system' | 'user'; content: string | Parte[] }[] = [];
	if (o.system.trim()) messages.push({ role: 'system', content: o.system });
	messages.push({ role: 'user', content: conteudo });

	const usaBusca = o.engine !== 'nenhum';
	let avisoPlugin: string | undefined;
	const corpo: Record<string, unknown> = {
		model: o.model.id,
		messages,
		temperature: o.temperature,
		max_tokens: o.maxTokens,
		...(o.json ? { response_format: { type: 'json_object' } } : {}),
		// Ver `raciocinio` em `OpcoesDaChamada`. `padrao`/ausente não manda nada,
		// que é o comportamento de sempre — só quem DECLARA muda de rota.
		...(o.raciocinio === 'desligado'
			? { reasoning: { enabled: false } }
			: o.raciocinio === 'baixo'
				? { reasoning: { effort: 'low' } }
				: {}),
	};

	if (usaBusca) {
		const { plugin, aviso } = montarPlugin({
			engine: o.engine as SearchEngine,
			maxResults: o.maxResults,
			includeDomains: o.includeDomains,
			excludeDomains: o.excludeDomains,
		});
		corpo.plugins = [plugin];
		avisoPlugin = aviso;
	}

	let completion: unknown;
	try {
		/**
		 * `plugins` não existe nos tipos do SDK `openai@6` — é extensão do
		 * OpenRouter. O `content` multimodal existe na API e não na tipagem da role
		 * `user`. Os dois casts ficam ISOLADOS aqui, num arquivo só, em vez de
		 * espalhados por cada agente.
		 */
		completion = await openrouter.chat.completions.create(corpo as never, {
			signal: o.signal,
			headers: {
				'HTTP-Referer': 'https://profissaolaser.com',
				'X-Title': o.titulo ?? 'Profissão Laser - Tools',
			},
		});
	} catch (err) {
		const e = err as { status?: number; name?: string };
		if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
			throw new ChamadaError('tempo esgotado', 'timeout');
		}
		if (e?.status === 429) throw new ChamadaError('limite de uso', 'rate');
		throw new ChamadaError(`falha na chamada (${e?.status ?? '?'})`, 'falha');
	}

	const c = completion as {
		error?: { message?: string };
		choices?: { message?: unknown }[];
		usage?: {
			prompt_tokens?: number;
			completion_tokens?: number;
			cost?: number;
		};
	};

	// HTTP 200 com `{error}` e sem `choices` — o SDK não trata como erro.
	if (c.error) {
		throw new ChamadaError(c.error.message ?? 'erro do provedor', 'falha');
	}

	const message = c.choices?.[0]?.message ?? null;
	const text = (message as { content?: string } | null)?.content ?? '';
	const citations = extrairCitacoes(message);

	const inTok = c.usage?.prompt_tokens ?? 0;
	const outTok = c.usage?.completion_tokens ?? 0;
	const buscas = usaBusca ? 1 : 0;
	// `usage.cost` do OpenRouter já inclui a busca quando vem; senão, estimamos.
	// A foto NÃO entra na estimativa como item à parte porque ela não é: o
	// provedor a cobra dentro de `prompt_tokens`, que é o número usado aqui.
	const custoUsd =
		typeof c.usage?.cost === 'number'
			? c.usage.cost
			: (inTok * o.model.pricing.in + outTok * o.model.pricing.out) / 1e6 +
				buscas * USD_POR_BUSCA;

	/**
	 * A GUARDA. Texto vazio NÃO é "nada encontrado" — é o modelo falhando com a
	 * chamada já paga. Sem isto a entrega sai muda e ninguém descobre por quê.
	 *
	 * O custo vai JUNTO no erro: esta é a chamada que mais some da contabilidade
	 * (busca cobrada + tokens queimados, resposta nenhuma), e é a que mais
	 * importa para conferir a margem depois.
	 */
	if (!text.trim()) {
		throw new ChamadaError(
			`o modelo '${o.model.id}' devolveu resposta vazia` +
				(citations.length
					? ` (mas cobrou ${citations.length} resultado(s) de busca)`
					: ''),
			'vazio',
			{ buscas, custoUsd },
		);
	}

	return {
		modelUsado: o.model.id,
		text: avisoPlugin ? `${text}\n\n[aviso] ${avisoPlugin}` : text,
		citations,
		usage: { in: inTok, out: outTok },
		buscas,
		custoUsd,
	};
}

/**
 * Outro modelo do catálogo, com as mesmas capacidades e QUALIDADE EQUIVALENTE.
 *
 * "Equivalente", e não "a melhor do catálogo", por dinheiro medido: a versão
 * anterior ordenava por qualidade DECRESCENTE e pegava o primeiro diferente do
 * atual — para o Estrategista e o Redator (os dois em `claude-sonnet-5`, faixa
 * `top`) isso dava sempre `claude-opus-5`, US$ 5/M de entrada e US$ 25/M de
 * saída. A segunda chamada custava US$ 0,133, e o rápido (2 voxxys = R$ 2,40)
 * caía de 78,6% para 48% de margem com UM retry — e o retry dispara em 1 de 7
 * runs reais.
 *
 * A ordem agora é: menor distância de faixa de qualidade primeiro (Sonnet `top`
 * procura outro `top`), e no empate o mais barato na SAÍDA — que é onde mora o
 * custo de quem escreve dossiê. `cabe` é o filtro de orçamento: quem não cabe no
 * que sobrou da execução não é alternativa, é o próximo prejuízo.
 */
export function escolherAlternativo(
	atual: string,
	precisaBusca: boolean,
	cabe?: (m: TextModelEntry) => boolean,
): TextModelEntry | null {
	const ordem: Record<string, number> = { standard: 0, high: 1, top: 2 };
	const alvo = ordem[findTextModel(atual)?.quality ?? 'high'] ?? 1;
	return (
		[...TEXT_MODELS_CATALOG]
			.filter((m) => m.id !== atual && m.json)
			.filter((m) => !precisaBusca || m.webSearch)
			.filter((m) => !cabe || cabe(m))
			.sort((a, b) => {
				const dist =
					Math.abs((ordem[a.quality] ?? 1) - alvo) -
					Math.abs((ordem[b.quality] ?? 1) - alvo);
				if (dist !== 0) return dist;
				return a.pricing.out - b.pricing.out;
			})[0] ?? null
	);
}

/**
 * O QUE UMA CHAMADA QUE FALHOU JÁ CUSTOU.
 *
 * `null` = nada saiu do bolso (o provedor recusou antes de rodar). Nos outros
 * casos o dinheiro existiu e tem que entrar no orçamento: sem isto, o
 * `custo_usd` do dossiê esconde justamente os runs caros — a resposta que o
 * modelo escreveu inteira e não fechou como JSON, e a que veio vazia com a
 * busca já cobrada (medido: os dois DeepSeek, 6 de 6 tentativas).
 *
 * Quando o erro não traz `usage` (timeout: a resposta não voltou), sobra o que
 * se sabe — a busca foi cobrada assim que a requisição chegou ao provedor.
 * Subestimar um pedaço é melhor que registrar zero.
 */
export function gastoDeFalha(
	err: unknown,
	comBusca: boolean,
): { buscas: number; custoUsd: number } | null {
	if (!(err instanceof ChamadaError)) return null;
	if (err.gasto) return err.gasto;
	if (err.kind === 'timeout' && comBusca) {
		return { buscas: 1, custoUsd: USD_POR_BUSCA };
	}
	return null;
}
