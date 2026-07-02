import OpenAI from 'openai';

/**
 * Embeddings plugáveis do RAG do OmniResposta. O OpenRouter (nosso agregador
 * de chat) NÃO expõe endpoint de embeddings, então o provedor vem de env:
 *   OMNI_EMBEDDINGS_PROVIDER = 'openai' | 'gemini' | 'none'
 *   (default: 'openai' se OPENAI_API_KEY existir; senão 'gemini' se
 *    GEMINI_API_KEY existir; senão 'none')
 * Dimensão FIXA em 1536 (coluna vector(1536) do pl_omni_kb_chunk):
 *   - openai: text-embedding-3-small com dimensions=1536 (nativo)
 *   - gemini: gemini-embedding-001 com outputDimensionality=1536 + normalização
 *     L2 (o Gemini só devolve normalizado na dimensão cheia de 3072)
 * `embed()` devolve null quando não há provedor — a busca do RAG cai no modo
 * keyword (tsvector). TROCAR de provedor exige reprocessar os arquivos da base
 * (embeddings de provedores diferentes não são comparáveis entre si).
 */

export const EMBEDDING_DIM = 1536;

type EmbeddingsProvider = 'openai' | 'gemini' | 'none';

function resolveProvider(): EmbeddingsProvider {
	const forced = (process.env.OMNI_EMBEDDINGS_PROVIDER ?? '').toLowerCase();
	if (forced === 'openai' || forced === 'gemini' || forced === 'none') {
		return forced;
	}
	if (process.env.OPENAI_API_KEY) return 'openai';
	if (process.env.GEMINI_API_KEY) return 'gemini';
	return 'none';
}

/** Provedor ativo (resolvido por env) — exposto p/ a UI/diagnóstico. */
export function embeddingsProvider(): EmbeddingsProvider {
	return resolveProvider();
}

let openaiClient: OpenAI | null = null;
function getOpenAi(): OpenAI {
	if (!openaiClient) {
		openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
	}
	return openaiClient;
}

const OPENAI_MODEL = 'text-embedding-3-small';
const GEMINI_MODEL = 'gemini-embedding-001';
const BATCH = 64;

function l2Normalize(v: number[]): number[] {
	let sum = 0;
	for (const x of v) sum += x * x;
	const norm = Math.sqrt(sum);
	if (norm === 0) return v;
	return v.map((x) => x / norm);
}

async function embedOpenAi(texts: string[]): Promise<number[][]> {
	const out: number[][] = [];
	for (let i = 0; i < texts.length; i += BATCH) {
		const slice = texts.slice(i, i + BATCH);
		const res = await getOpenAi().embeddings.create({
			model: OPENAI_MODEL,
			input: slice,
			dimensions: EMBEDDING_DIM,
		});
		// A API preserva a ordem; ordena por index por segurança.
		const sorted = [...res.data].sort((a, b) => a.index - b.index);
		for (const d of sorted) out.push(d.embedding);
	}
	return out;
}

interface GeminiBatchResponse {
	embeddings?: Array<{ values?: number[] }>;
}

async function embedGemini(texts: string[]): Promise<number[][]> {
	const key = process.env.GEMINI_API_KEY;
	const out: number[][] = [];
	for (let i = 0; i < texts.length; i += BATCH) {
		const slice = texts.slice(i, i + BATCH);
		const res = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:batchEmbedContents?key=${key}`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					requests: slice.map((text) => ({
						model: `models/${GEMINI_MODEL}`,
						content: { parts: [{ text }] },
						outputDimensionality: EMBEDDING_DIM,
					})),
				}),
			},
		);
		if (!res.ok) {
			throw new Error(`gemini embeddings HTTP ${res.status}`);
		}
		const json = (await res.json()) as GeminiBatchResponse;
		for (const e of json.embeddings ?? []) {
			if (!e.values || e.values.length !== EMBEDDING_DIM) {
				throw new Error('gemini embeddings: dimensão inesperada');
			}
			// Fora de 3072 o Gemini NÃO normaliza — cosine exige norma 1.
			out.push(l2Normalize(e.values));
		}
	}
	if (out.length !== texts.length) {
		throw new Error('gemini embeddings: contagem divergente');
	}
	return out;
}

/**
 * Gera embeddings (dimensão 1536) para os textos. Devolve `null` quando não há
 * provedor configurado — o chamador deve cair no modo keyword. Erros de rede
 * propagam (o chamador decide entre falhar o arquivo ou seguir sem vetor).
 */
export async function embed(texts: string[]): Promise<number[][] | null> {
	if (texts.length === 0) return [];
	const provider = resolveProvider();
	if (provider === 'none') return null;
	if (provider === 'openai') return embedOpenAi(texts);
	return embedGemini(texts);
}

/** Embedding de UMA query (atalho p/ busca). null = sem provedor. */
export async function embedQuery(text: string): Promise<number[] | null> {
	const res = await embed([text]);
	if (res === null) return null;
	return res[0] ?? null;
}
