/**
 * Catálogo curado de modelos de TEXTO disponíveis via OpenRouter. Exposto pelo
 * endpoint `GET /api/text-models` para a UI da Fábrica de Tools permitir ao
 * staff escolher qual modelo usar em `ai.text` — o espelho, para texto, do que
 * `image-models-catalog.ts` já faz para `ai.generate_image`.
 *
 * - Estático (sem auto-discovery): o staff edita este array; a UI consome via
 *   `useTextModelCatalog`. Cache in-process 1h (TTL_MS).
 * - `default: true` marca o modelo padrão (usado quando a tool não seta
 *   `definition.text_model`).
 *
 * Diferenças estruturais em relação ao catálogo de imagem — texto precisa de
 * quatro coisas que imagem não precisava:
 *   1. `toolUse`: sem tool-calling o modelo NÃO pode rodar como agente. É o
 *      filtro que impede o admin de escolher um modelo que vai falhar em runtime.
 *   2. `json`: suporte a saída estruturada (o bloco `ai.text` usa quando
 *      `json: true`).
 *   3. `pricing`: alimenta o metering por token (`voxesFromUsage`), que hoje
 *      usa preço fixo de env.
 *   4. `provider`: de onde sai a chamada. Hoje tudo é `openrouter` (uma chave,
 *      uma fatura). `anthropic` existe para, no futuro, fixar um agente caro no
 *      SDK nativo quando o prompt caching justificar.
 *
 * IMPORTANTE — armadilha já paga uma vez: o catálogo de IMAGEM chegou a ter 6
 * ids mortos (`gpt-image-1`, `flux`, `sd`, `recraft`, `ideogram`) que só
 * quebravam em runtime, porque foram escritos de memória. NENHUMA entrada nova
 * entra aqui sem ser conferida contra `GET https://openrouter.ai/api/v1/models`
 * com a chave real. Os ids abaixo foram conferidos em 2026-08-03.
 *
 * E há uma quinta coisa, aprendida do jeito caro: `webSearch`. Suportar tools
 * NÃO implica funcionar com o plugin de busca do OpenRouter.
 *
 * ┌─ POR QUE NÃO HÁ DEEPSEEK AQUI (não readicione sem testar) ───────────────┐
 * │ `deepseek/deepseek-v4-pro` e `deepseek-v4-flash-0731` eram os mais       │
 * │ baratos do catálogo — e por isso mesmo eram a escolha natural do admin.  │
 * │ Medido em 2026-08-03: COM busca web, devolveram `content: ""` em 6/6     │
 * │ tentativas, com as citações preenchidas — ou seja, a busca é cobrada     │
 * │ (US$ 0,005) e o texto não vem. SEM busca, falham de forma intermitente:  │
 * │ são modelos de RACIOCÍNIO e gastam o orçamento de saída pensando (num    │
 * │ teste, 11.695 caracteres de raciocínio para 400 tokens pedidos).         │
 * │ O modo de falha é o pior possível: silencioso, pago e intermitente.      │
 * │ Um modelo barato que às vezes não responde custa mais que um caro que    │
 * │ sempre responde.                                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

export type TextModelBestFor =
	/** Planejar, decidir, consolidar. */
	| 'raciocinio'
	/** Geometria, encaixes, cálculo dimensional — interpretar pedido de CAD. */
	| 'cad'
	/** Ler texto sujo / arquivo e devolver JSON. */
	| 'extracao'
	/** Copy PT-BR: proposta comercial, descrição para o cliente final. */
	| 'redacao'
	/** Avaliar e consolidar a saída de outros agentes. */
	| 'juiz'
	/** Aceita imagem no input (diagnóstico por foto). */
	| 'visao'
	/** Volume e rascunho, onde o custo importa mais que o acabamento. */
	| 'barato';

/** Velocidade típica de resposta. `slow` é ruim para tool de cliente. */
export type TextModelSpeed = 'instant' | 'fast' | 'medium' | 'slow';
/** Acabamento geral esperado. */
export type TextModelQuality = 'standard' | 'high' | 'top';
/** De onde sai a chamada. `anthropic` = SDK nativo (prompt caching real). */
export type TextModelProvider = 'anthropic' | 'openrouter';

/** Preço em USD por 1.000.000 de tokens. Alimenta o metering. */
export interface TextModelPricing {
	in: number;
	out: number;
	/** Só o provider `anthropic` reporta cache; OpenRouter não expõe. */
	cacheWrite?: number;
	cacheRead?: number;
}

export interface TextModelEntry {
	/** Id verbatim do provedor (ex.: `'anthropic/claude-sonnet-5'`). */
	id: string;
	provider: TextModelProvider;
	/** Nome PT-BR exibido no dropdown. */
	label: string;
	/** Tags do que o modelo é bom. A UI filtra por aqui. */
	bestFor: TextModelBestFor[];
	speed: TextModelSpeed;
	quality: TextModelQuality;
	/** Janela de contexto em milhares de tokens. */
	contextK: number;
	/** Suporta tool-calling. SEM isto o modelo não roda ferramenta. */
	toolUse: boolean;
	/** Suporta saída estruturada / `response_format`. */
	json: boolean;
	/** Aceita imagem no input. */
	vision: boolean;
	/**
	 * Funciona com o plugin de busca web do OpenRouter
	 * (`plugins: [{ id: 'web' }]`). NÃO é o mesmo que "suporta tools".
	 *
	 * Hoje todo modelo do catálogo tem `true` — porque os que tinham `false`
	 * foram REMOVIDOS (ver o histórico do DeepSeek no topo do arquivo). O campo
	 * continua existindo, e `resolveTextModel({needsWebSearch})` continua
	 * filtrando por ele, para que o próximo modelo barato que alguém queira
	 * adicionar seja testado com busca ANTES de virar opção no dropdown.
	 */
	webSearch: boolean;
	pricing: TextModelPricing;
	/** 1-2 frases PT-BR exibidas como subtítulo quando selecionado. */
	notes: string;
	/** Marca o modelo padrão do sistema. */
	default?: boolean;
	/** "Melhor da faixa X" — alvo do fallback quando a tool pede só um tier. */
	tierDefault?: TextModelSpeed;
}

export const TEXT_MODELS_CATALOG: ReadonlyArray<TextModelEntry> = [
	{
		id: 'anthropic/claude-sonnet-5',
		provider: 'openrouter',
		label: 'Claude Sonnet 5 (padrão)',
		bestFor: ['raciocinio', 'cad', 'juiz', 'redacao', 'visao'],
		speed: 'medium',
		quality: 'top',
		contextK: 1000,
		toolUse: true,
		json: true,
		webSearch: true,
		vision: true,
		pricing: { in: 2, out: 10 },
		notes:
			'Melhor custo-benefício com uso de ferramentas. Contexto de 1M, aceita imagem e segue schema de saída com confiabilidade. É o padrão para orquestrar agentes e para interpretar pedido em linguagem natural.',
		default: true,
		tierDefault: 'medium',
	},
	{
		id: 'anthropic/claude-opus-5',
		provider: 'openrouter',
		label: 'Claude Opus 5 (raciocínio pesado)',
		bestFor: ['raciocinio', 'juiz', 'cad', 'visao'],
		speed: 'slow',
		quality: 'top',
		contextK: 1000,
		toolUse: true,
		json: true,
		webSearch: true,
		vision: true,
		pricing: { in: 5, out: 25 },
		notes:
			'O mais capaz do catálogo. Use como juiz/consolidador e nas decisões difíceis. 2,5x mais caro que o Sonnet 5 na saída — não use como agente de volume.',
		tierDefault: 'slow',
	},
	{
		id: 'anthropic/claude-haiku-4.5',
		provider: 'openrouter',
		label: 'Claude Haiku 4.5 (rápido)',
		bestFor: ['extracao', 'barato', 'visao'],
		speed: 'fast',
		quality: 'high',
		contextK: 200,
		toolUse: true,
		json: true,
		webSearch: true,
		vision: true,
		pricing: { in: 1, out: 5 },
		notes:
			'Latência baixa com uso de ferramentas e visão. Ideal para extrair campos, classificar e rotular — as tarefas onde o modelo grande é desperdício.',
		tierDefault: 'fast',
	},
	{
		id: 'google/gemini-3.1-flash-lite',
		provider: 'openrouter',
		label: 'Gemini 3.1 Flash Lite (econômico)',
		bestFor: ['barato', 'extracao', 'visao'],
		speed: 'instant',
		quality: 'standard',
		contextK: 1000,
		toolUse: true,
		json: true,
		webSearch: true,
		vision: true,
		pricing: { in: 0.25, out: 1.5 },
		notes:
			'O mais barato com contexto de 1M e multimodal completo. Para volume alto, rascunho e pré-processamento onde o acabamento não é crítico.',
		tierDefault: 'instant',
	},
	{
		id: 'google/gemini-3-flash-preview',
		provider: 'openrouter',
		label: 'Gemini 3 Flash (redação)',
		bestFor: ['redacao', 'barato', 'visao'],
		speed: 'fast',
		quality: 'high',
		contextK: 1000,
		toolUse: true,
		json: true,
		webSearch: true,
		vision: true,
		pricing: { in: 0.5, out: 3 },
		notes:
			'Bom texto corrido em PT-BR por um preço baixo. Escolha natural para redigir proposta comercial e descrição para o cliente final.',
	},
	{
		id: 'google/gemini-3.1-pro-preview',
		provider: 'openrouter',
		label: 'Gemini 3.1 Pro (visão longa)',
		bestFor: ['visao', 'raciocinio', 'extracao'],
		speed: 'medium',
		quality: 'top',
		contextK: 1000,
		toolUse: true,
		json: true,
		webSearch: true,
		vision: true,
		pricing: { in: 2, out: 12 },
		notes:
			'Multimodal completo (imagem, vídeo e áudio) com 1M de contexto. Use para diagnóstico por foto — ex.: analisar a borda de um corte e apontar escória ou queima.',
	},
];

const TTL_MS = 60 * 60 * 1000;
let cache: { at: number; data: TextModelEntry[] } | null = null;

/**
 * Retorna o catálogo (cópia rasa do array). Cache in-process 1h.
 * `force=true` ignora o cache (usado em testes).
 */
export function getTextModelsCatalog(force = false): TextModelEntry[] {
	const now = Date.now();
	if (!force && cache && now - cache.at < TTL_MS) return cache.data;
	cache = { at: now, data: [...TEXT_MODELS_CATALOG] };
	return cache.data;
}

/** Entrada marcada como `default: true`, ou a primeira do catálogo. */
export function getDefaultTextModel(): TextModelEntry {
	const found = TEXT_MODELS_CATALOG.find((m) => m.default);
	if (found) return found;
	// O catálogo nunca é vazio (é um literal deste arquivo); o `as` evita
	// espalhar `| undefined` por todos os chamadores por um caso impossível.
	return TEXT_MODELS_CATALOG[0] as TextModelEntry;
}

/** Id do modelo padrão. Espelha `getDefaultImageModelId()`. */
export function getDefaultTextModelId(): string {
	return getDefaultTextModel().id;
}

export function findTextModel(id: string): TextModelEntry | undefined {
	return TEXT_MODELS_CATALOG.find((m) => m.id === id);
}

export interface ResolveTextModelOpts {
	/** Faixa desejada quando não há id explícito. */
	tier?: TextModelSpeed;
	/** O chamador vai passar ferramentas — descarta modelo sem tool-calling. */
	needsToolUse?: boolean;
	/** O chamador vai mandar imagem — descarta modelo sem visão. */
	needsVision?: boolean;
	/**
	 * O chamador vai ligar o plugin de busca — descarta modelo que devolve
	 * resposta vazia com busca (os DeepSeek). É o filtro que impede um agente de
	 * pesquisa de gastar a busca e não produzir nada.
	 */
	needsWebSearch?: boolean;
}

/**
 * Resolve qual modelo usar, na mesma filosofia de
 * `injectModelOverrides` (`controllers/tool-run.ts`): id desconhecido
 * NUNCA derruba a execução — cai no padrão e loga.
 *
 * Ordem: (1) `id` no catálogo e compatível com os requisitos; (2) melhor da
 * faixa `tier` que atenda os requisitos; (3) padrão do catálogo; (4) primeiro
 * do catálogo que atenda os requisitos.
 */
export function resolveTextModel(
	id: string | undefined,
	opts: ResolveTextModelOpts = {},
): TextModelEntry {
	const fits = (m: TextModelEntry) =>
		(!opts.needsToolUse || m.toolUse) &&
		(!opts.needsVision || m.vision) &&
		(!opts.needsWebSearch || m.webSearch);

	if (id) {
		const found = findTextModel(id);
		if (found && fits(found)) return found;
		console.warn(
			found
				? `[text-models] modelo '${id}' não atende aos requisitos (toolUse=${opts.needsToolUse ?? false}, vision=${opts.needsVision ?? false}, webSearch=${opts.needsWebSearch ?? false}); usando o padrão`
				: `[text-models] modelo de texto desconhecido '${id}'; usando o padrão`,
		);
	}

	if (opts.tier) {
		const byTier = TEXT_MODELS_CATALOG.find(
			(m) => m.tierDefault === opts.tier && fits(m),
		);
		if (byTier) return byTier;
	}

	const fallback = getDefaultTextModel();
	if (fits(fallback)) return fallback;

	const any = TEXT_MODELS_CATALOG.find(fits);
	if (any) return any;

	// Nenhum modelo atende: devolve o padrão mesmo assim. Falhar aqui deixaria a
	// tool sem saída; falhar na chamada dá um erro muito mais legível.
	return fallback;
}
