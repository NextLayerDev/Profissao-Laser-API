import sharp from 'sharp';
import { z } from 'zod';
import { generateToolImage } from '../../lib/image-gen.js';
import type { FxOutput } from '../lib/pixels.js';
import { fxSharp } from '../lib/pixels.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos de IA EXTRA (categoria `ai`) — port do grupo "AI" do ImagR. Embrulham
 * a geração de imagem multimodal (`lib/image-gen` → Gemini Image via OpenRouter,
 * NÃO o modelo exato do ImagR) e operações de re-amostragem. Saída padrão de
 * filtro: `{ png, pngBase64 }`. `image.upscale` é o único que NÃO usa IA — só
 * redimensiona com Lanczos (sharp nativo).
 */

const img = z.instanceof(Buffer);

/** Açúcar: define um bloco de IA com schema {image, ...P}. Mesma assinatura do adjust.ts. */
function block<P extends z.ZodRawShape>(
	id: string,
	description: string,
	shape: P,
	run: (
		params: z.infer<z.ZodObject<P & { image: typeof img }>>,
	) => Promise<FxOutput>,
): ToolBlock {
	const schema = z.object({ image: img, ...shape });
	return {
		id,
		category: 'ai',
		description,
		paramsSchema: schema as z.ZodType<unknown>,
		run: (_ctx, params) =>
			run(params as z.infer<z.ZodObject<P & { image: typeof img }>>),
	} as ToolBlock;
}

/* ───────────────────────────── Upscale (não-IA) ───────────────────────────── */

export const upscaleBlock = block(
	'image.upscale',
	'Amplia 2/4/8/16× com reamostragem Lanczos3 (não é IA).',
	{ factor: z.enum(['2', '4', '8', '16']).default('2').transform(Number) },
	async (p) => {
		// Lê dimensões reais e multiplica pelo fator escolhido.
		const meta = await sharp(p.image).metadata();
		const w = meta.width ?? 0;
		const h = meta.height ?? 0;
		return fxSharp(p.image, (s) =>
			s.resize(w * p.factor, h * p.factor, { kernel: 'lanczos3' }),
		);
	},
);

/* ───────────────────────────── IA (Gemini Image) ───────────────────────────── */

export const backgroundRemovalBlock = block(
	'ai.backgroundRemoval',
	'Remove o fundo deixando o objeto sobre fundo branco (IA — Gemini Image).',
	{},
	(p) =>
		// Usa Gemini Image (não o modelo exato do ImagR).
		generateToolImage(
			'Remova completamente o fundo desta imagem, deixando o objeto principal sobre fundo BRANCO sólido. Não altere o objeto.',
			[p.image],
		),
);

export const colorizeBlock = block(
	'ai.colorize',
	'Coloriza foto P&B com cores realistas e naturais (IA — Gemini Image).',
	{},
	(p) =>
		// Usa Gemini Image (não o modelo exato do ImagR).
		generateToolImage(
			'Colorize esta foto em preto e branco com cores realistas e naturais, preservando todos os detalhes.',
			[p.image],
		),
);

export const restorationBlock = block(
	'ai.restoration',
	'Restaura foto antiga/danificada: remove riscos/ruído e recupera nitidez (IA — Gemini Image).',
	{},
	(p) =>
		// Usa Gemini Image (não o modelo exato do ImagR).
		generateToolImage(
			'Restaure e melhore esta foto antiga/danificada: remova riscos e ruído, recupere nitidez e detalhes, mantendo a aparência original.',
			[p.image],
		),
);

/** Todos os blocos de IA extra, pra registro no index. */
export const aiExtraBlocks: ToolBlock[] = [
	upscaleBlock,
	backgroundRemovalBlock,
	colorizeBlock,
	restorationBlock,
];
