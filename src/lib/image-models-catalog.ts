/**
 * Catálogo curado de modelos de imagem disponíveis via OpenRouter. Exposto
 * pelo endpoint `GET /api/image-models` para a UI da Fábrica de Tools permitir
 * ao staff escolher, POR TOOL, qual modelo usar em `ai.generate_image`.
 *
 * - Estático (sem auto-discovery): o staff edita este array quando precisar
 *   adicionar/remover um modelo; a UI consome via `useImageModelCatalog`.
 * - Cache in-process 1h (TTL_MS) — sem Redis, é estático.
 * - `default: true` marca o modelo padrão (usado quando a tool não seta
 *   `definition.model`).
 * - `speed` / `quality`: a UI mostra com ícone pra o admin escolher consciente
 *   (modelo lento = ruim pra tool de cliente). `speed` é tempo típico de
 *   geração; `quality` é o acabamento geral esperado.
 *
 * IMPORTANTE: rótulos e notas em PT-BR. `bestFor` é uma tag livre
 * (`'laser' | 'poster' | 'text' | 'photoreal' | 'typography' | 'identity' |
 * 'vector'`) que a UI usa pra filtrar o dropdown.
 */

export type ImageModelBestFor =
	| 'laser'
	| 'poster'
	| 'text'
	| 'photoreal'
	| 'typography'
	| 'identity'
	| 'vector';

/** Velocidade típica de geração. `slow` ≈ 1min+ (ruim pra cliente). */
export type ImageModelSpeed = 'fast' | 'medium' | 'slow';
/** Acabamento geral esperado. */
export type ImageModelQuality = 'standard' | 'high' | 'top';

export interface ImageModelEntry {
	/** OpenRouter model id (ex.: `'google/gemini-3-pro-image-preview'`). */
	id: string;
	/** Nome PT-BR exibido no dropdown. */
	label: string;
	/** Tags do que o modelo é bom. UI filtra por aqui. */
	bestFor: ImageModelBestFor[];
	/** Velocidade típica (UI mostra com ícone + aviso se `slow`). */
	speed: ImageModelSpeed;
	/** Qualidade/acabamento (UI mostra com ícone). */
	quality: ImageModelQuality;
	/** 1-2 frases PT-BR exibidas como subtítulo quando o modelo está selecionado. */
	notes: string;
	/** Marca o modelo padrão do sistema (usado se a tool não setar `model`). */
	default?: boolean;
}

export const IMAGE_MODELS_CATALOG: ReadonlyArray<ImageModelEntry> = [
	{
		id: 'google/gemini-3-pro-image-preview',
		label: 'Gemini 3 Pro Image · Nano Banana Pro (padrão laser)',
		bestFor: ['laser', 'vector'],
		speed: 'medium',
		quality: 'top',
		notes:
			'Modelo padrão atual. Forte em ilustração 2D limpa, alto contraste, sem cinza — o "look laser". Pode engessar casos fotorrealistas ou com muito texto na imagem.',
		default: true,
	},
	{
		id: 'google/gemini-3-pro-image',
		label: 'Gemini 3 Pro Image · Nano Banana Pro (estável)',
		bestFor: ['laser', 'vector', 'typography'],
		speed: 'medium',
		quality: 'top',
		notes:
			'Versão GA (estável) do Nano Banana Pro — mesmo "look laser" do padrão, sem o rótulo preview. Boa aderência ao prompt e renderização de texto acima da média. Prefira quando quiser estabilidade.',
	},
	{
		id: 'openai/gpt-5.4-image-2',
		label: 'OpenAI GPT-5.4 Image 2 (top qualidade · lento)',
		bestFor: ['photoreal', 'poster', 'typography', 'text', 'identity'],
		speed: 'slow',
		quality: 'top',
		notes:
			'Modelo #1 de imagem (OpenAI GPT-5.4 + GPT Image 2) — a MELHOR qualidade/detalhe, nível do print gerado direto no ChatGPT. MUITO lento (~2,5-3 min por imagem) e mais caro. Use quando qualidade importa mais que velocidade.',
	},
	{
		id: 'openai/gpt-5-image',
		label: 'OpenAI GPT-5 Image',
		bestFor: ['typography', 'text', 'poster'],
		speed: 'slow',
		quality: 'high',
		notes:
			'Geração GPT-5 de imagem da OpenAI. Tipografia forte e composição de cartaz. LENTO (~1,5min por imagem). Um degrau abaixo do 5.4 Image 2 em qualidade, mas um pouco mais rápido. OBS: modelos GPT podem RECUSAR rostos de pessoas reais/famosos — nesses casos use um Gemini.',
	},
	{
		id: 'openai/gpt-5-image-mini',
		label: 'OpenAI GPT-5 Image Mini (econômico)',
		bestFor: ['typography', 'text'],
		speed: 'medium',
		quality: 'high',
		notes:
			'Variante leve do GPT-5 Image: mais rápida e barata que o GPT-5 Image cheio, mantendo boa renderização de texto. Boa para volume e rascunhos com tipografia.',
	},
	{
		id: 'google/gemini-3.1-flash-image',
		label: 'Gemini 3.1 Flash Image · Nano Banana 2 (rápido)',
		bestFor: ['laser', 'photoreal', 'poster'],
		speed: 'fast',
		quality: 'high',
		notes:
			'Tier Flash do Nano Banana 2: bem mais rápido e barato que o Pro, com qualidade geral alta. Melhor equilíbrio velocidade/qualidade para tool de cliente.',
	},
	{
		id: 'google/gemini-3.1-flash-lite-image',
		label: 'Gemini 3.1 Flash Lite Image · Nano Banana 2 Lite (econômico)',
		bestFor: ['laser', 'poster'],
		speed: 'fast',
		quality: 'standard',
		notes:
			'O mais barato e rápido da família Gemini image. Use para prévias, testes e altíssimo volume onde o custo importa mais que o acabamento.',
	},
	{
		id: 'google/gemini-2.5-flash-image',
		label: 'Gemini 2.5 Flash Image · Nano Banana (geração anterior)',
		bestFor: ['photoreal', 'poster', 'identity'],
		speed: 'fast',
		quality: 'standard',
		notes:
			'Geração anterior (Nano Banana original). Alternativa estável e conhecida, com bom fotorrealismo. Mantido como fallback.',
	},
];

const TTL_MS = 60 * 60 * 1000;
let cache: { at: number; data: ImageModelEntry[] } | null = null;

/**
 * Retorna o catálogo (cópia rasa do array). Cache in-process 1h.
 * `force=true` ignora o cache (usado em testes).
 */
export function getImageModelsCatalog(force = false): ImageModelEntry[] {
	const now = Date.now();
	if (!force && cache && now - cache.at < TTL_MS) return cache.data;
	cache = { at: now, data: [...IMAGE_MODELS_CATALOG] };
	return cache.data;
}

/**
 * Devolve o id do modelo marcado como `default: true` no catálogo, ou
 * `undefined` se nenhum estiver marcado. Usado como fallback quando uma tool
 * não tem `definition.model` setado e o env `OPENROUTER_IMAGE_MODEL` está vazio.
 */
export function getDefaultImageModelId(): string | undefined {
	return IMAGE_MODELS_CATALOG.find((m) => m.default)?.id;
}
