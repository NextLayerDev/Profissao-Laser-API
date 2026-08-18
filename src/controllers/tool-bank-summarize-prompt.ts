import type { FastifyReply, FastifyRequest } from 'fastify';
import { openrouter } from '../lib/openrouter.js';

/**
 * "Resumir prompt" — encurta o `prompt_script` do admin quando ele se aproxima
 * do limite de `ai.generate_image` (`z.string().max(8_000)`, ver
 * `tool-blocks/blocks/ai.ts`), preservando TODO `{placeholder}` (tema e
 * quaisquer especificações custom) intacto. Rota admin-only, mesmo molde de
 * `tool-bank-smart-tema.ts` — análise é função só de `prompt_script`/`mode`,
 * sem depender da tool.
 */
const SUMMARIZE_MODEL = 'google/gemini-2.5-flash';

/** Placeholders `{palavra}` do script — usados pra checar que sobreviveram ao resumo. */
function extractPlaceholders(script: string): Set<string> {
	const set = new Set<string>();
	for (const m of script.matchAll(/\{(\w+)\}/g)) set.add(m[1]);
	return set;
}

const SUMMARIZE_PROMPT = (script: string, targetChars: number): string =>
	`Encurte o prompt abaixo pra no máximo ${targetChars} caracteres, preservando o sentido, o estilo e todas as instruções importantes.

REGRAS:
- Preserve TODO marcador {palavra} EXATAMENTE como está (ex.: {tema}, {nome_jogador}) — nunca remova, renomeie ou reescreva um marcador.
- Corte redundância, repetição e detalhe excessivo — não corte instruções únicas.
- Retorne APENAS o prompt encurtado, sem explicações.
- NÃO adicione markdown, aspas ou formatação extra.

PROMPT:
${script}`;

interface SummarizePromptBody {
	prompt_script: string;
	mode?: string;
	target_chars?: number;
}

const DEFAULT_TARGET_CHARS = 6_000;
const MIN_TARGET_CHARS = 500;
const MAX_TARGET_CHARS = 8_000;

export const summarizePromptController = async (
	request: FastifyRequest<{ Body: SummarizePromptBody }>,
	reply: FastifyReply,
) => {
	const { prompt_script, target_chars } = request.body ?? {};

	if (!prompt_script || !prompt_script.trim()) {
		return reply.status(400).send({ message: 'Script vazio.' });
	}

	const targetChars = Math.min(
		MAX_TARGET_CHARS,
		Math.max(MIN_TARGET_CHARS, target_chars ?? DEFAULT_TARGET_CHARS),
	);

	// Short-circuit: já está dentro do alvo — nada a fazer.
	if (prompt_script.length <= targetChars) {
		return reply.send({ result: prompt_script, unchanged: true });
	}

	if (!process.env.OPENROUTER_API_KEY) {
		// Sem chave: não arrisca truncar cru (corta no meio de frase/placeholder).
		// Devolve o original e deixa o admin encurtar manualmente.
		return reply.send({ result: prompt_script, fallback: true });
	}

	const originalPlaceholders = extractPlaceholders(prompt_script);

	try {
		const completion = await openrouter.chat.completions.create({
			model: SUMMARIZE_MODEL,
			messages: [
				{ role: 'user', content: SUMMARIZE_PROMPT(prompt_script, targetChars) },
			],
		});
		const result = completion.choices[0]?.message?.content?.trim();
		if (!result) {
			return reply.send({ result: prompt_script, fallback: true });
		}
		// A IA pode ter derrubado algum {placeholder} no resumo — nesse caso não
		// arrisca devolver um prompt quebrado, cai no original.
		const resultPlaceholders = extractPlaceholders(result);
		for (const p of originalPlaceholders) {
			if (!resultPlaceholders.has(p)) {
				return reply.send({ result: prompt_script, fallback: true });
			}
		}
		return reply.send({
			result,
			shortened: result.length < prompt_script.length,
		});
	} catch (err) {
		// Erro de API → devolve o original (nunca um resumo malformado).
		const e = err as { message?: string };
		return reply.send({
			result: prompt_script,
			fallback: true,
			error: e?.message,
		});
	}
};
