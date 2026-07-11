import { z } from 'zod';
import { generateToolImage } from '../../lib/image-gen.js';
import type { ToolBlock } from '../types.js';

/**
 * `ai.generate_image` — gera uma imagem a partir de um texto (e até 3 imagens de
 * referência opcionais) via OpenRouter Gemini image (embrulha `lib/image-gen`).
 * Saídas `png` (Buffer, p/ `output.upload_png`) + `pngBase64` (preview inline),
 * mesmo contrato do `laser.photoengrave`.
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
});

export const aiGenerateImageBlock: ToolBlock<
	z.infer<typeof aiGenerateImageSchema>
> = {
	id: 'ai.generate_image',
	category: 'ai',
	description:
		'Gera uma imagem a partir de um texto (e até 3 imagens de referência opcionais) via Gemini Image.',
	paramsSchema: aiGenerateImageSchema,
	async run(ctx, params) {
		const refs = [params.image, params.image2, params.image3].filter(
			(b): b is Buffer => Buffer.isBuffer(b),
		);
		const { png, pngBase64 } = await generateToolImage(
			params.prompt,
			refs,
			ctx.signal,
			{ model: params.model, systemPromptOverride: params.system_prompt },
		);
		return { png, pngBase64 };
	},
};
