import { openrouter } from '../lib/openrouter.js';
import {
	type AiResponse,
	buildMessages,
	buildRetrievalQuery,
	parseAiResponse,
} from '../lib/support-chat-prompt.js';
import { searchKnowledge } from '../lib/support-kb-search.js';
import type { KbSearchResult } from '../types/ai-kb.js';
import type { SupportMessageRole } from '../types/support-chat.js';

/** Contexto de autenticação repassado à busca (Bearer do aluno + id). */
export interface AuthContext {
	authHeader?: string | null;
	userId?: string | null;
}

/**
 * Geração da resposta da IA do suporte, extraída do serviço de chat.
 *
 * Existe separado por um motivo prático: o playground do admin ("Testar a IA")
 * precisa produzir EXATAMENTE a mesma resposta que o aluno receberia. Se cada
 * um montasse o próprio prompt, o teste passaria a mentir com o tempo — a staff
 * validaria uma resposta que a produção não dá.
 */

export const SUPPORT_CHAT_MODEL =
	process.env.SUPPORT_CHAT_MODEL || 'google/gemini-2.5-flash';

interface HistoryItem {
	role: SupportMessageRole;
	content: string;
}

// Reexportado por conveniência: quem gera resposta normalmente também precisa
// montar a query. A implementação mora no módulo de prompt (função pura).
export { buildRetrievalQuery };

export interface GenerateResult extends AiResponse {
	kb: KbSearchResult;
}

/**
 * Roda um turno completo: busca conhecimento, monta o prompt, chama o modelo e
 * parseia. LANÇA em caso de falha do modelo — quem chama decide o fallback
 * (o chat degrada pra handoff; o playground mostra o erro pra staff).
 */
export async function generateAiReply(
	history: HistoryItem[],
	options: { knowledge?: KbSearchResult; auth?: AuthContext } = {},
): Promise<GenerateResult> {
	if (!process.env.OPENROUTER_API_KEY) {
		throw new Error('OPENROUTER_API_KEY não configurada');
	}

	// A busca já degrada sozinha e nunca lança, então não precisa de try aqui.
	// O contexto de auth é repassado pra upvox, que é dona do Cérebro.
	const kb =
		options.knowledge ??
		(await searchKnowledge(buildRetrievalQuery(history), {
			authHeader: options.auth?.authHeader,
			userId: options.auth?.userId,
		}));

	const messages = buildMessages(history, kb.context);

	const completion = await openrouter.chat.completions.create(
		{
			model: SUPPORT_CHAT_MODEL,
			messages,
			temperature: 0.3,
			max_tokens: 500,
		},
		{
			headers: {
				'HTTP-Referer':
					process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
				'X-Title': `${process.env.NEXT_PUBLIC_COMPANY_SYSTEM ?? 'Profissão Laser'} - Suporte`,
			},
		},
	);

	const raw = completion.choices[0]?.message?.content ?? '';
	const parsed = parseAiResponse(
		typeof raw === 'string' ? raw : JSON.stringify(raw),
	);

	return { ...parsed, kb };
}
