import type { FastifyReply, FastifyRequest } from 'fastify';
import { openrouter } from '../lib/openrouter.js';

/**
 * "Add tema inteligente" — port do "Injetar {USER_INPUT}" do comunidade_laser,
 * adaptado ao marcador `{tema}` (convenção deste projeto, substituído em
 * `tool-run.ts:substituteVars`). O admin escreve o `prompt_script`; a IA
 * (gemini-2.5-flash) lê e insere `{tema}` no lugar ideal. Rota admin-only
 * (`authenticateAdmin` no preHandler); a análise é função só de
 * `prompt_script` + `mode`, sem depender da tool.
 */
const SMART_MODEL = 'google/gemini-2.5-flash';

const ANALYSIS_PROMPT = (script: string): string =>
	`Analise este prompt e identifique ONDE o input do usuário (tema, assunto, texto personalizado) deve ser inserido. Substitua esse trecho pela variável exata {tema}.

REGRAS:
- Mantenha o prompt EXATAMENTE igual, apenas insira {tema} no lugar correto.
- Se o prompt termina com algo como "Tema:", "Assunto:", "Subject:" ou similar, coloque {tema} logo após.
- Se não há lugar óbvio, adicione no final: "Tema: {tema}".
- Retorne APENAS o prompt modificado, sem explicações.
- NÃO adicione markdown, aspas ou formatação extra.

PROMPT:
${script}`;

interface SmartTemaBody {
	prompt_script: string;
	mode?: string;
}

const fallbackScript = (script: string): string =>
	`${script.trimEnd()}\n\nTema: {tema}`;

export const smartTemaController = async (
	request: FastifyRequest<{ Body: SmartTemaBody }>,
	reply: FastifyReply,
) => {
	const { prompt_script, mode } = request.body ?? {};

	if (!prompt_script || !prompt_script.trim()) {
		return reply.status(400).send({ message: 'Script vazio.' });
	}

	// Short-circuit 1: já tem o marcador — devolve como está.
	if (prompt_script.includes('{tema}')) {
		return reply.send({ result: prompt_script, already: true });
	}
	// Short-circuit 2: modo só-imagem não tem tema do aluno — nada a inserir.
	if (mode === 'imagem') {
		return reply.send({ result: prompt_script, not_needed: true });
	}

	if (!process.env.OPENROUTER_API_KEY) {
		// Sem chave, ainda devolve um prompt utilizável (fallback).
		return reply.send({
			result: fallbackScript(prompt_script),
			fallback: true,
		});
	}

	try {
		const completion = await openrouter.chat.completions.create({
			model: SMART_MODEL,
			messages: [{ role: 'user', content: ANALYSIS_PROMPT(prompt_script) }],
		});
		const result = completion.choices[0]?.message?.content?.trim();
		if (!result || !result.includes('{tema}')) {
			// IA não devolveu o marcador — anexa no final pra não quebrar o fluxo.
			return reply.send({
				result: fallbackScript(prompt_script),
				fallback: true,
			});
		}
		return reply.send({ result });
	} catch (err) {
		// Erro de API → fallback. Admin nunca sai de mãos vazias.
		const e = err as { message?: string };
		return reply.send({
			result: fallbackScript(prompt_script),
			fallback: true,
			error: e?.message,
		});
	}
};
