import { z } from 'zod';
import { type GenImageResult, generateToolImage } from '../../lib/image-gen.js';
import type { ToolBlock } from '../types.js';

/**
 * `ai.generate_image` — gera uma imagem a partir de um texto (e até 3 imagens de
 * referência opcionais) via OpenRouter Gemini image (embrulha `lib/image-gen`).
 * Saídas `png` (Buffer, p/ `output.upload_png`) + `pngBase64` (preview inline),
 * mesmo contrato do `laser.photoengrave`.
 *
 * `variation_count` — quantas imagens gerar (1–4). As N chamadas ao modelo rodam
 * em **paralelo** (`Promise.allSettled`) pra baixar a latência total (2×/4×
 * custa ~1× o tempo de 1, não N×). `images` devolve as que saíram; `png`/
 * `pngBase64` apontam pra 1ª delas (back-compat de output).
 * Cobrança escala por variação (vox_cost × N) — veja `authorizeAndCharge` no
 * upvox; o motor settle/refund a invocation única cujo `voxes_spent` já vem N×.
 *
 * `raw_prompt` — quando true, o motor manda SÓ a user message ao modelo (sem
 * system prompt, sem `TEXT_LEAD`; o sufixo `FORMATO` continua indo — é spec de
 * formato, não intermediação de estilo). Se o modelo suportar (catálogo
 * `unifiedImagesApi:true`), a geração roteia pro endpoint dedicado
 * `POST /v1/images` da OpenRouter, com `aspect_ratio`/`resolution`/`quality`
 * REAIS em vez de só o texto; o sharp (`fit:'cover'`) garante a dimensão exata
 * por cima disso. Vem de `definition.raw_prompt` (Prompts Mágicos).
 */

// O motor injeta `null` num input de imagem não preenchido (coerceInputs). A
// referência é OPCIONAL, então o schema tolera Buffer | null | undefined — usar
// só `z.instanceof(Buffer)` quebraria a geração só-texto.
const optionalImage = z.union([z.instanceof(Buffer), z.null(), z.undefined()]);

const aiGenerateImageSchema = z.object({
	prompt: z.string().min(1).max(8_000),
	image: optionalImage,
	image2: optionalImage,
	image3: optionalImage,
	/**
	 * A quarta vaga existe pela arte licenciada: o escudo da marca ocupa a
	 * primeira (`marca.png`), e o aluno tem direito a TRÊS fotos — com três
	 * vagas, a terceira foto chegava como `referencia3`, a definition não a
	 * declarava e o motor recusava com "Arquivo inesperado". O gerador não
	 * tem teto de referências; o teto era só deste schema.
	 */
	image4: optionalImage,
	/**
	 * Override do modelo OpenRouter (injetado pelo motor a partir de
	 * `definition.model` na Fábrica de Tools). Ausente = default do env.
	 * `.max(200)` casa com o upvox (evita payload absurdo pro OpenRouter).
	 */
	model: z.string().min(1).max(200).optional(),
	/**
	 * Override do system prompt (injetado pelo motor a partir de
	 * `definition.system_prompt`). Ausente/vazio = prompt laser padrão.
	 */
	system_prompt: z.string().min(1).optional(),
	/**
	 * Dimensões EXATAS de saída em px (injetadas do `definition.image_width/height`
	 * ou, quando a tool tem `creations`, da creation escolhida pelo cliente).
	 * O motor injeta a proporção no prompt e redimensiona a saída pra WxH exato.
	 */
	width: z.number().int().min(64).max(4096).optional(),
	height: z.number().int().min(64).max(4096).optional(),
	/**
	 * TRUE = manda SÓ a user message ao modelo (sem intermediação). Injetado do
	 * `definition.raw_prompt` (Prompts Mágicos). Ausente/false = comportamento
	 * legado com system prompt + sufixo de formato.
	 */
	raw_prompt: z.boolean().optional(),
	/**
	 * Quantas variações gerar (1–4). Injetado do `creation_id`/`variation_count`
	 * do request, validado contra `definition.return_variations`. Default 1.
	 * As N chamadas ao modelo rodam em paralelo; billing escala por variação.
	 */
	variation_count: z.number().int().min(1).max(4).optional(),
	/**
	 * Tier de `quality` (só família GPT; os Gemini não aceitam e ele é
	 * ignorado). Ausente = `'medium'`. É o override POR FERRAMENTA: a tool que
	 * precisa do topo declara `quality: 'high'` no próprio nó da definition.
	 * Ver `bestQuality` em `lib/image-gen.ts`.
	 */
	quality: z.enum(['auto', 'low', 'medium', 'high']).optional(),
});

export const aiGenerateImageBlock: ToolBlock<
	z.infer<typeof aiGenerateImageSchema>
> = {
	id: 'ai.generate_image',
	category: 'ai',
	description:
		'Gera uma imagem a partir de um texto (e até 4 imagens de referência opcionais) via Gemini Image.',
	paramsSchema: aiGenerateImageSchema,
	async run(ctx, params) {
		const refs = [
			params.image,
			params.image2,
			params.image3,
			params.image4,
		].filter((b): b is Buffer => Buffer.isBuffer(b));
		const n = Math.max(1, Math.min(4, params.variation_count ?? 1));
		// `rawPrompt` → `fit:'cover'` (crop sem distorção; sem o sufixo no prompt
		// o modelo tende a quadrado e `fill` distorceria). Legado → `fit:'fill'`
		// (a proporção é reforçada no prompt, então não distorce na prática).
		// `as const` é necessário: sem ele o ternário infere `string` e não estreita
		// para a união `'fill' | 'cover' | 'contain'` que `generateToolImage` exige.
		const fit = params.raw_prompt ? ('cover' as const) : ('fill' as const);
		const buildOpts = () => ({
			model: params.model,
			systemPromptOverride: params.system_prompt,
			width: params.width,
			height: params.height,
			rawPrompt: params.raw_prompt,
			fit,
			quality: params.quality,
			atribuicao: { toolKey: ctx.toolKey },
		});
		/**
		 * Paralelo: N chamadas simultâneas ao modelo — 2×/4× variações custam
		 * ~1× o tempo de 1 (não N×).
		 *
		 * ┌─ POR QUE `allSettled`, E O QUE ELE AINDA NÃO RESOLVE ──────────────┐
		 * │ Com `Promise.all`, UMA variação que falhasse (429, 504, recusa)     │
		 * │ derrubava o run: o controller estornava a invocação inteira e as    │
		 * │ outras 1–3 imagens, já pagas ao OpenRouter, iam para o lixo. Agora  │
		 * │ o aluno recebe as que saíram, e o run só falha se NENHUMA sair      │
		 * │ (aí o estorno é integral, como sempre).                             │
		 * │                                                                      │
		 * │ O que falta: o upvox só estorna a invocação INTEIRA                 │
		 * │ (`POST /v1/tool/invocation/:id/refund`, sem valor). Não há como     │
		 * │ devolver só as variações que falharam — o run parcial liquida pelo  │
		 * │ valor cheio (vox_cost × N). O log abaixo deixa o caso visível até   │
		 * │ existir um estorno parcial no upvox.                                │
		 * └──────────────────────────────────────────────────────────────────────┘
		 */
		const tentativas = await Promise.allSettled(
			Array.from({ length: n }, () =>
				generateToolImage(params.prompt, refs, ctx.signal, buildOpts()),
			),
		);
		const images = tentativas
			.filter(
				(t): t is PromiseFulfilledResult<GenImageResult> =>
					t.status === 'fulfilled',
			)
			.map((t) => t.value);
		if (images.length === 0) {
			// Nenhuma saiu: propaga o 1º erro (o controller estorna tudo).
			const primeira = tentativas.find(
				(t): t is PromiseRejectedResult => t.status === 'rejected',
			);
			throw primeira?.reason;
		}
		if (images.length < n) {
			console.warn(
				'[ai.generate_image] variações parciais: entregue o que saiu, cobrança cheia (o upvox não estorna parcial)',
				{
					toolKey: ctx.toolKey,
					pedidas: n,
					entregues: images.length,
					erros: tentativas
						.filter((t): t is PromiseRejectedResult => t.status === 'rejected')
						.map((t) => (t.reason as Error)?.message ?? String(t.reason)),
				},
			);
		}
		// Back-compat: png/pngBase64 = 1ª imagem (definition.output.primary/preview
		// legados). `images` é o array completo p/ o novo output.images (Passo 3).
		return {
			png: images[0].png,
			pngBase64: images[0].pngBase64,
			images,
		};
	},
};
