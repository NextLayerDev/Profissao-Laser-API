import type { KbSearchResult } from '../types/ai-kb.js';

/**
 * Cliente da busca no Cérebro da IA.
 *
 * O Cérebro vive na upvox. A IA do chat de suporte (aqui na main API) consome a
 * busca chamando `POST /v1/ai-knowledge/search`, repassando o Bearer do próprio
 * aluno — o mesmo padrão que `lib/upvox-tools.ts` já usa para a cobrança de
 * tools (o aluno é usuário válido da upvox, então não precisa de secret novo).
 * Por isso: ZERO env nova além de `EXTERNAL_API_URL`, que já existe.
 *
 * Regra inquebrável: ISTO NUNCA DERRUBA O TURNO. Toda falha (upvox fora,
 * timeout, sem token) vira um resultado vazio e a IA responde como respondia
 * antes de existir RAG. Nada aqui lança.
 */

const EXTERNAL_API_URL = process.env.EXTERNAL_API_URL ?? '';
const TIMEOUT_MS = Number(process.env.AI_KB_SEARCH_TIMEOUT_MS || 1500);

function empty(
	reason: KbSearchResult['reason'],
	startedAt: number,
): KbSearchResult {
	return {
		context: '',
		hits: [],
		mode: 'none',
		reason,
		latencyMs: Date.now() - startedAt,
	};
}

interface SearchOptions {
	authHeader?: string | null;
	userId?: string | null;
	k?: number;
	minSimilarity?: number;
}

export async function searchKnowledge(
	query: string,
	options: SearchOptions = {},
): Promise<KbSearchResult> {
	const startedAt = Date.now();
	const trimmed = query.trim();
	if (!trimmed) return empty('empty_query', startedAt);
	if (!EXTERNAL_API_URL) return empty('unreachable', startedAt);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		// Repassa o Bearer do aluno (vale no gateway) E o x-user-id (confiado
		// quando a chamada vai direto ao upvox) — idêntico ao upvox-tools.
		if (options.authHeader) headers.Authorization = options.authHeader;
		if (options.userId) headers['x-user-id'] = options.userId;

		const res = await fetch(
			`${EXTERNAL_API_URL.replace(/\/$/, '')}/v1/ai-knowledge/search`,
			{
				method: 'POST',
				headers,
				body: JSON.stringify({
					query: trimmed,
					k: options.k,
					minSimilarity: options.minSimilarity,
				}),
				signal: controller.signal,
			},
		);

		if (!res.ok) {
			console.warn(`[support-kb] busca respondeu HTTP ${res.status}`);
			return empty('rpc_error', startedAt);
		}

		const data = (await res.json()) as Partial<KbSearchResult>;
		return {
			context: typeof data.context === 'string' ? data.context : '',
			hits: Array.isArray(data.hits) ? data.hits : [],
			mode: data.mode ?? 'none',
			reason: data.reason ?? 'ok',
			latencyMs: Date.now() - startedAt,
		};
	} catch (err) {
		const reason =
			err instanceof Error && err.name === 'AbortError'
				? 'global_timeout'
				: 'unreachable';
		console.warn('[support-kb] busca falhou, seguindo sem base:', err);
		return empty(reason, startedAt);
	} finally {
		clearTimeout(timer);
	}
}
