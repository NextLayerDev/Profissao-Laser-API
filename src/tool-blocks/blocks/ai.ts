import { z } from 'zod';
import {
	appendFormatHint,
	applyTemplateMask,
} from '../../lib/creation-template.js';
import { type GenImageResult, generateToolImage } from '../../lib/image-gen.js';
import type { ToolBlock } from '../types.js';

/**
 * `ai.generate_image` — gera uma imagem a partir de um texto (e até 3 imagens de
 * referência opcionais) via OpenRouter Gemini image (embrulha `lib/image-gen`).
 * Saídas `png` (Buffer, p/ `output.upload_png`) + `pngBase64` (preview inline),
 * mesmo contrato do `laser.photoengrave`.
 *
 * `variation_count` — quantas imagens gerar (1–4). As N chamadas ao modelo rodam
 * em **paralelo** (`Promise.all`) pra baixar a latência total (2×/4× custa
 * ~1× o tempo de 1, não N×). `images` devolve o array completo; `png`/`pngBase64`
 * apontam pra 1ª imagem (back-compat de output).
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
	 * Instrução de FORMATO (injetada pelo motor a partir do molde do formato
	 * escolhido — `lib/creation-template.ts`). Vai colada no fim do prompt:
	 * proporção física, cantos e as zonas que a IA deve deixar livres.
	 */
	format_hint: z.string().max(4_000).optional(),
	/**
	 * Molde a RECORTAR depois da geração (fora do contorno e zonas proibidas →
	 * alfa 0). A IA não obedece geometria; a máscara obedece. Forma validada
	 * no motor (`templateProblem`) antes de chegar aqui.
	 */
	mask_template: z
		.object({
			width_mm: z.number().positive(),
			height_mm: z.number().positive(),
			outline: z.enum(['rect', 'ellipse']).optional(),
			corner_radius_mm: z.number().min(0).optional(),
			safe_margin_mm: z.number().min(0).optional(),
			zones: z
				.array(
					z.object({
						label: z.string().optional(),
						shape: z.enum(['rect', 'ellipse']),
						x: z.number(),
						y: z.number(),
						w: z.number().positive(),
						h: z.number().positive(),
						r: z.number().min(0).optional(),
					}),
				)
				.optional(),
		})
		.optional(),
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
		// Paralelo: N chamadas simultâneas ao modelo — 2×/4× variações custam
		// ~1× o tempo de 1 (não N×). 429 individual já é tratado em `image-gen`
		// (refund); o `Promise.allSettled`-style aqui rejeita se QUALQUER uma
		// falhar, e o controller refunda a invocation única (cobrança N× já
		// embutida no voxes_spent). Modelos muito lentos podem 504 com 4× — o
		// admin escolhe o allowlist de variações ciente do modelo da tool.
		const buildOpts = () => ({
			model: params.model,
			systemPromptOverride: params.system_prompt,
			width: params.width,
			height: params.height,
			rawPrompt: params.raw_prompt,
			fit,
		});
		const prompt = appendFormatHint(params.prompt, params.format_hint ?? '');
		const generated: GenImageResult[] =
			n === 1
				? [await generateToolImage(prompt, refs, ctx.signal, buildOpts())]
				: await Promise.all(
						Array.from({ length: n }, () =>
							generateToolImage(prompt, refs, ctx.signal, buildOpts()),
						),
					);
		// Recorte do molde DEPOIS do resize: a máscara é calculada no tamanho
		// final, então o contorno cai exatamente na borda da peça.
		const mask = params.mask_template;
		const images: GenImageResult[] = mask
			? await Promise.all(
					generated.map(async (g) => {
						const png = await applyTemplateMask(g.png, mask);
						return {
							png,
							pngBase64: `data:image/png;base64,${png.toString('base64')}`,
						};
					}),
				)
			: generated;
		// Back-compat: png/pngBase64 = 1ª imagem (definition.output.primary/preview
		// legados). `images` é o array completo p/ o novo output.images (Passo 3).
		return {
			png: images[0].png,
			pngBase64: images[0].pngBase64,
			images,
		};
	},
};
