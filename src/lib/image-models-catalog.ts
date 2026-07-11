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

export interface ImageModelEntry {
	/** OpenRouter model id (ex.: `'google/gemini-3-pro-image-preview'`). */
	id: string;
	/** Nome PT-BR exibido no dropdown. */
	label: string;
	/** Tags do que o modelo é bom. UI filtra por aqui. */
	bestFor: ImageModelBestFor[];
	/** 1-2 frases PT-BR exibidas como subtítulo quando o modelo está selecionado. */
	notes: string;
	/** Marca o modelo padrão do sistema (usado se a tool não setar `model`). */
	default?: boolean;
}

export const IMAGE_MODELS_CATALOG: ReadonlyArray<ImageModelEntry> = [
	{
		id: 'google/gemini-3-pro-image-preview',
		label: 'Gemini 3 Pro Image (padrão laser)',
		bestFor: ['laser', 'vector'],
		notes:
			'Modelo padrão atual. Forte em ilustração 2D limpa, alto contraste, sem cinza — o "look laser". Pode engessar casos fotorrealistas ou com texto na imagem.',
		default: true,
	},
	{
		id: 'openai/gpt-image-1',
		label: 'OpenAI GPT Image 1',
		bestFor: ['typography', 'text', 'poster'],
		notes:
			'Tipografia forte e composição de cartaz. Boa renderização de texto na imagem (placas, slogans, números). Para posters e logos com texto.',
	},
	{
		id: 'black-forest-labs/flux-1.1-pro',
		label: 'FLUX 1.1 Pro (Black Forest Labs)',
		bestFor: ['photoreal', 'poster', 'identity'],
		notes:
			'Fotorrealismo de alto nível. Bom para posters com pessoas, preserva identidade visual em grau moderado. Não é laser.',
	},
	{
		id: 'black-forest-labs/flux-pro',
		label: 'FLUX Pro (Black Forest Labs)',
		bestFor: ['photoreal', 'poster'],
		notes:
			'Variante anterior do FLUX 1.1. Alternativa estável quando o 1.1 não estiver disponível.',
	},
	{
		id: 'stability-ai/stable-diffusion-3.5-large',
		label: 'Stable Diffusion 3.5 Large',
		bestFor: ['text', 'typography', 'photoreal'],
		notes:
			'Boa renderização de texto na imagem (3.5 deu salto grande). Alternativa intermediária entre FLUX e GPT Image.',
	},
	{
		id: 'recraft-ai/recraft-v3',
		label: 'Recraft v3',
		bestFor: ['typography', 'poster', 'vector'],
		notes:
			'Especializado em cartazes e tipografia. Mantém vetorização limpa; ótimo para posters de eventos, slogans, layouts editoriais.',
	},
	{
		id: 'ideogram-ai/ideogram-2.0',
		label: 'Ideogram 2.0',
		bestFor: ['text', 'typography'],
		notes:
			'O melhor desta lista para texto na imagem (legendas, números, fontes estilizadas). Use quando o prompt precisa de letreiros legíveis.',
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
