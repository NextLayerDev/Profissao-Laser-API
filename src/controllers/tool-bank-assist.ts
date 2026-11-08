import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	ChamadaError,
	chamarModelo,
	type SearchEngine,
} from '../lib/agent-team/llm.js';
import { extractJson } from '../lib/llm-json.js';
import {
	cardSystemPrompt,
	cardUserPrompt,
	normalizeCardSuggestion,
	normalizePhoneSuggestion,
	normalizePopular,
	phoneSystemPrompt,
	phoneUserPrompt,
	popularSystemPrompt,
	popularUserPrompt,
} from '../lib/prompt-studio-assist.js';
import { resolveTextModel } from '../lib/text-models-catalog.js';

/**
 * Sugestões de IA do Estúdio de Prompts (admin). Três pedidos:
 *  - `card`: uma frase vira título, categoria, prompt com {tema} e formatos;
 *  - `phone`: o nome do celular vira medidas e área da câmera (busca na web);
 *  - `popular`: os mais vendidos no Brasil que ainda faltam na biblioteca.
 *
 * Nada aqui grava: a resposta volta para o formulário, o admin revisa e salva.
 */
export type AssistBody =
	| {
			kind: 'card';
			idea: string;
			formats?: { id: string; label: string }[];
			categories?: string[];
	  }
	| { kind: 'phone'; name: string }
	| { kind: 'popular'; existing?: string[] };

/** Rápido, barato, aceita JSON e busca web (ver o catálogo). */
const MODEL_ID = 'google/gemini-3-flash-preview';
const TIMEOUT_MS = 60_000;

async function ask(o: {
	system: string;
	user: string;
	search: boolean;
	signal: AbortSignal;
}): Promise<unknown> {
	const model = resolveTextModel(MODEL_ID, { needsWebSearch: o.search });
	const r = await chamarModelo({
		model,
		system: o.system,
		user: o.user,
		engine: o.search ? ('exa' as SearchEngine) : 'nenhum',
		maxResults: 5,
		maxTokens: 2_000,
		temperature: o.search ? 0.1 : 0.7,
		json: true,
		signal: o.signal,
		titulo: 'Profissão Laser - Estúdio de Prompts',
		raciocinio: 'baixo',
	});
	return extractJson(r.text);
}

export const promptAssistController = async (
	request: FastifyRequest<{ Body: AssistBody }>,
	reply: FastifyReply,
) => {
	if (!process.env.OPENROUTER_API_KEY) {
		return reply
			.status(503)
			.send({ message: 'A IA de sugestões não está configurada.' });
	}
	const body = request.body;
	const signal = AbortSignal.timeout(TIMEOUT_MS);

	try {
		if (body.kind === 'card') {
			const formats = body.formats ?? [];
			const raw = await ask({
				system: cardSystemPrompt(),
				user: cardUserPrompt({
					idea: body.idea,
					formats,
					categories: body.categories ?? [],
				}),
				search: false,
				signal,
			});
			const card = normalizeCardSuggestion(
				raw,
				formats.map((f) => f.id),
			);
			if (!card) {
				return reply.status(502).send({
					message: 'A IA não conseguiu montar o card. Tente de novo.',
				});
			}
			return reply.send({ card });
		}

		if (body.kind === 'phone') {
			const raw = await ask({
				system: phoneSystemPrompt(),
				user: phoneUserPrompt(body.name),
				search: true,
				signal,
			});
			const phone = normalizePhoneSuggestion(raw);
			if ('error' in phone) {
				return reply.status(422).send({ message: phone.error });
			}
			return reply.send({ phone });
		}

		const existing = body.existing ?? [];
		const raw = await ask({
			system: popularSystemPrompt(),
			user: popularUserPrompt(existing),
			search: true,
			signal,
		});
		return reply.send({ models: normalizePopular(raw, existing) });
	} catch (err) {
		const msg =
			err instanceof ChamadaError
				? err.mensagemParaTela
				: 'A IA não respondeu agora. Tente de novo em instantes.';
		request.log.warn({ err }, 'prompt-assist falhou');
		return reply.status(502).send({ message: msg });
	}
};
