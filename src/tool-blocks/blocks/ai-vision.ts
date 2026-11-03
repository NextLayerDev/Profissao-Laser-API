import { z } from 'zod';
import { imagemParaDataUrl, LADO_PADRAO } from '../../lib/agent-team/imagem.js';
import { extractJson } from '../../lib/llm-json.js';
import { openrouter } from '../../lib/openrouter.js';
import {
	resolveTextModel,
	type TextModelEntry,
} from '../../lib/text-models-catalog.js';
import { ToolEngineError } from '../../lib/tool-errors.js';
import type { ToolBlock } from '../types.js';

/**
 * `ai.vision` — olha uma FOTO e devolve uma ficha estruturada.
 *
 * Espelha `ai.text` (mesmo mapa de erros, mesmo retry sem `response_format`,
 * mesmo `extractJson`) e acrescenta as duas coisas que texto não precisava:
 * conteúdo multimodal e redução da imagem.
 *
 * REGRA DE OURO, herdada de `lib/quote/pricing.ts` ("nenhum número vem de
 * LLM"): este bloco extrai CLASSES e FAIXAS, nunca geometria fina. Modelo é bom
 * em "isso tem uns 10 × 15 cm" e péssimo em "o perímetro mede 843 mm". Quem
 * transforma classe em número é fórmula com tabela auditável, do lado de fora.
 *
 * Também aceita `fallback`: quando não há foto (o aluno só descreveu o produto,
 * ou colou uma ficha técnica), o bloco roda como texto puro em vez de falhar.
 * A ferramenta tem que responder a "quero analisar uma caneca" sem exigir foto.
 */

const GEN_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_CHARS = 200_000;

const aiVisionSchema = z.object({
	/**
	 * A foto. `null` é caminho VÁLIDO (o motor injeta null em input vazio): sem
	 * imagem o bloco usa `fallback` e roda como texto.
	 */
	image: z.instanceof(Buffer).nullish(),
	/** Descrição digitada, usada quando não há foto. */
	fallback: z.string().max(20_000).default(''),
	/**
	 * Contexto vindo de outro nó — tipicamente a saída de um `collection.query`.
	 *
	 * Existe porque a classificação PRECISA de um vocabulário fechado e a lista
	 * mora numa coleção, não no prompt. Sem isto o modelo inventa um slug por
	 * execução ("brindes-personalizados" numa, "copo-termico" na outra) e duas
	 * perguntas sobre o mesmo produto nunca compartilham a pesquisa de mercado —
	 * o cache deixa de existir na prática. Aconteceu no primeiro run de teste.
	 *
	 * Aceita qualquer coisa: string vai como está, objeto/array é serializado.
	 */
	contexto: z.unknown().optional(),
	/** Rótulo do contexto, para o modelo saber o que é aquilo. */
	contexto_label: z.string().max(200).default('Contexto'),
	system: z.string().max(20_000).default(''),
	user: z.string().min(1).max(60_000),
	model: z.string().min(1).max(200).optional(),
	max_side: z.coerce.number().int().min(256).max(2048).default(LADO_PADRAO),
	max_tokens: z.coerce.number().int().min(1).max(16_000).default(900),
	temperature: z.coerce.number().min(0).max(2).default(0.1),
});

type AiVisionParams = z.infer<typeof aiVisionSchema>;

/** Parte de conteúdo no formato multimodal da API compatível com OpenAI. */
type Parte =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } };

async function complete(
	model: TextModelEntry,
	params: AiVisionParams,
	partes: Parte[],
	useJsonFormat: boolean,
	signal: AbortSignal,
): Promise<string> {
	const messages: {
		role: 'system' | 'user';
		content: string | Parte[];
	}[] = [];
	if (params.system.trim()) {
		messages.push({ role: 'system', content: params.system });
	}
	messages.push({ role: 'user', content: partes });

	const completion = await openrouter.chat.completions.create(
		{
			model: model.id,
			// O SDK tipa `content` como string para a role `user`; o formato
			// multimodal é o padrão da API e o cast é local, não espalhado.
			messages: messages as never,
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

	// OpenRouter às vezes responde HTTP 200 com `{error}` e sem `choices`.
	const asError = (completion as unknown as { error?: { message?: string } })
		.error;
	if (asError) {
		throw new ToolEngineError(
			502,
			`Falha no modelo de visão: ${asError.message ?? 'erro desconhecido'}`,
		);
	}

	return completion.choices?.[0]?.message?.content ?? '';
}

export const aiVisionBlock: ToolBlock<AiVisionParams> = {
	id: 'ai.vision',
	category: 'ai',
	description:
		'Olha uma foto (ou uma descrição, quando não há foto) e devolve uma ficha estruturada em JSON. Sempre em faixas e classes, nunca em geometria fina.',
	paramsSchema: aiVisionSchema,
	async run(ctx, params) {
		const temImagem = Boolean(params.image?.byteLength);
		if (!temImagem && !params.fallback.trim()) {
			throw new ToolEngineError(
				400,
				'Envie uma foto do produto ou descreva o que você quer analisar.',
			);
		}

		/**
		 * Sem foto, não exigimos visão — assim um modelo barato de texto puro
		 * atende o caminho "só descrevi o produto". Com foto, `needsVision`
		 * descarta quem não enxerga, e `resolveTextModel` nunca derruba o run.
		 */
		const model = resolveTextModel(params.model, { needsVision: temImagem });

		const partes: Parte[] = [{ type: 'text', text: params.user }];
		if (params.contexto !== undefined && params.contexto !== null) {
			const txt =
				typeof params.contexto === 'string'
					? params.contexto
					: JSON.stringify(params.contexto);
			if (txt && txt !== '{}' && txt !== '[]') {
				partes.push({
					type: 'text',
					text: `${params.contexto_label}:\n${txt.slice(0, 12_000)}`,
				});
			}
		}
		if (params.fallback.trim()) {
			partes.push({
				type: 'text',
				text: `Informações que o usuário digitou:\n${params.fallback}`,
			});
		}
		if (temImagem && params.image) {
			ctx.onProgress?.({ kind: 'vision_preparando' });
			partes.push({
				type: 'image_url',
				image_url: {
					url: await imagemParaDataUrl(params.image, params.max_side),
				},
			});
		}

		const timeout = AbortSignal.timeout(GEN_TIMEOUT_MS);
		const signal = ctx.signal
			? AbortSignal.any([ctx.signal, timeout])
			: timeout;

		ctx.onProgress?.({ kind: 'vision_analisando', model: model.id });

		let text: string;
		try {
			text = await complete(model, params, partes, model.json, signal);
		} catch (err) {
			const e = err as { status?: number; code?: number; name?: string };
			if (err instanceof ToolEngineError) throw err;
			const isBadRequest =
				typeof e?.status === 'number' && e.status >= 400 && e.status < 500;
			if (model.json && isBadRequest) {
				text = await complete(model, params, partes, false, signal);
			} else if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
				throw new ToolEngineError(504, 'Tempo esgotado na leitura da foto.');
			} else if (e?.status === 429 || e?.code === 429) {
				throw new ToolEngineError(
					429,
					'Limite de uso da IA atingido. Tente de novo em instantes.',
				);
			} else {
				throw new ToolEngineError(502, 'Falha ao analisar a foto.');
			}
		}

		if (text.length > MAX_OUTPUT_CHARS) text = text.slice(0, MAX_OUTPUT_CHARS);

		/**
		 * Resposta VAZIA é falha explícita, nunca sucesso mudo.
		 *
		 * Aconteceu de verdade e é o motivo de `webSearch` existir no catálogo:
		 * há modelo que devolve `content: ""` com HTTP 200. Tratar isso como "ok,
		 * sem dados" faria a ferramenta inteira sair em branco sem ninguém saber
		 * por quê — e com a chamada já cobrada.
		 */
		if (!text.trim()) {
			throw new ToolEngineError(
				502,
				`O modelo '${model.id}' devolveu resposta vazia. Troque o modelo desta etapa.`,
			);
		}

		const json = extractJson(text);
		if (json === undefined) {
			throw new ToolEngineError(
				502,
				'A IA não devolveu um JSON válido ao ler a foto. Ajuste o prompt ou troque o modelo.',
			);
		}

		ctx.onProgress?.({ kind: 'vision_pronto' });
		return { json, text, model: model.id, usou_imagem: temImagem };
	},
};
