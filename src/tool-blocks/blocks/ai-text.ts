import { z } from 'zod';
import { extractJson } from '../../lib/llm-json.js';
import { openrouter } from '../../lib/openrouter.js';
import {
	resolveTextModel,
	type TextModelEntry,
} from '../../lib/text-models-catalog.js';
import { ToolEngineError } from '../../lib/tool-errors.js';
import type { ToolBlock } from '../types.js';

/**
 * `ai.text` — raciocínio/redação por LLM dentro de um pipeline `blocks_v1`.
 * É o espelho, para texto, do que `ai.generate_image` é para imagem: o admin
 * escolhe o modelo na Fábrica (`definition.text_model`) e o motor injeta aqui.
 *
 * Com este bloco, QUALQUER tool existente ganha um passo de IA de texto sem
 * runtime novo, sem job assíncrono e sem billing novo — é o degrau anterior ao
 * runtime multi-agente (`agent_v1`).
 *
 * Saídas: `text` (string sempre) e `json` (objeto, só quando `json: true`).
 *
 * Nota de preview: `skipInPreview` no `tool-run.ts` pula todo bloco cujo id
 * começa com `ai.`, então `ai.text` NUNCA roda no `/preview` — a prévia
 * continua grátis e nenhum token é gasto de graça. Isso é de propósito.
 */

const GEN_TIMEOUT_MS = 90_000;
/** Teto de caracteres da resposta. Protege a bag do motor e o payload de saída. */
const MAX_OUTPUT_CHARS = 200_000;

const aiTextSchema = z.object({
	/**
	 * Instrução de sistema (papel/regras). Injetável pelo motor a partir de
	 * `definition.text_system_prompt`.
	 */
	system: z.string().max(20_000).default(''),
	/** O prompt em si. Normalmente vem de `util.text_template`. */
	user: z.string().min(1).max(60_000),
	/**
	 * Override do modelo (injetado do `definition.text_model`). Validado contra
	 * o catálogo curado; id fora do catálogo cai no padrão com warning, nunca
	 * derruba o run.
	 */
	model: z.string().min(1).max(200).optional(),
	/** Pede saída estruturada. A saída vai em `json` além de `text`. */
	json: z.coerce.boolean().default(false),
	temperature: z.coerce.number().min(0).max(2).default(0.3),
	max_tokens: z.coerce.number().int().min(1).max(16_000).default(1_200),
});

type AiTextParams = z.infer<typeof aiTextSchema>;

async function complete(
	model: TextModelEntry,
	params: AiTextParams,
	useJsonFormat: boolean,
	signal: AbortSignal,
): Promise<string> {
	const messages: { role: 'system' | 'user'; content: string }[] = [];
	if (params.system.trim()) {
		messages.push({ role: 'system', content: params.system });
	}
	messages.push({ role: 'user', content: params.user });

	const completion = await openrouter.chat.completions.create(
		{
			model: model.id,
			messages,
			temperature: params.temperature,
			max_tokens: params.max_tokens,
			...(useJsonFormat ? { response_format: { type: 'json_object' } } : {}),
		},
		{
			signal,
			headers: {
				'HTTP-Referer': 'https://profissaolaser.com',
				'X-Title': 'Profissão Laser - Tools',
			},
		},
	);

	// OpenRouter às vezes responde HTTP 200 com `{error}` e sem `choices` — o SDK
	// não trata isso como erro. Mesma guarda que `image-gen.ts` já faz.
	const asError = (completion as unknown as { error?: { message?: string } })
		.error;
	if (asError) {
		throw new ToolEngineError(
			502,
			`Falha no modelo de texto: ${asError.message ?? 'erro desconhecido'}`,
		);
	}

	return completion.choices?.[0]?.message?.content ?? '';
}

export const aiTextBlock: ToolBlock<AiTextParams> = {
	id: 'ai.text',
	category: 'ai',
	description:
		'Raciocínio/redação por LLM: recebe system + prompt e devolve texto (e JSON, se pedido). O modelo é escolhido pelo admin na Fábrica.',
	paramsSchema: aiTextSchema,
	async run(ctx, params) {
		const model = resolveTextModel(params.model);

		const timeout = AbortSignal.timeout(GEN_TIMEOUT_MS);
		const signal = ctx.signal
			? AbortSignal.any([ctx.signal, timeout])
			: timeout;

		let text: string;
		try {
			text = await complete(model, params, params.json && model.json, signal);
		} catch (err) {
			const e = err as { status?: number; code?: number; name?: string };
			if (err instanceof ToolEngineError) throw err;
			// Retry sem `response_format`: nem todo provedor por trás do OpenRouter
			// aceita structured output, e o erro vem como 4xx. O upvox já provou
			// que esse retry é necessário (`lib/openrouter.ts` de lá faz o mesmo).
			const isBadRequest =
				typeof e?.status === 'number' && e.status >= 400 && e.status < 500;
			if (params.json && model.json && isBadRequest) {
				text = await complete(model, params, false, signal);
			} else if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
				throw new ToolEngineError(504, 'Tempo esgotado na resposta da IA.');
			} else if (e?.status === 429 || e?.code === 429) {
				throw new ToolEngineError(
					429,
					'Limite de uso da IA atingido. Tente de novo em instantes.',
				);
			} else {
				throw new ToolEngineError(502, 'Falha ao consultar a IA de texto.');
			}
		}

		if (text.length > MAX_OUTPUT_CHARS) {
			text = text.slice(0, MAX_OUTPUT_CHARS);
		}

		if (!params.json) return { text, json: null, model: model.id };

		const json = extractJson(text);
		if (json === undefined) {
			throw new ToolEngineError(
				502,
				'A IA não devolveu um JSON válido. Ajuste o prompt ou troque o modelo.',
			);
		}
		return { text, json, model: model.id };
	},
};
