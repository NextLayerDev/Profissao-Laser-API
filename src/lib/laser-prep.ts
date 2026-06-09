import sharp from 'sharp';
import type { LaserPrepParams } from '../types/laser-prep.js';
import { laserPrepParamsSchema } from '../types/laser-prep.js';
import type { DitherAlgorithm } from './dithering.js';
import { applyDithering } from './dithering.js';

/**
 * Perfis de material — porte 1:1 do dict `MATERIALS` do `imagr_pipeline.py`
 * (referência de engenharia reversa do ImagR "One Click").
 *
 * `invert: true`  → material grava CLARO sobre fundo escuro (ardósia, vidro,
 *                   metal, azulejo pintado de preto). A imagem é invertida para
 *                   que as áreas escuras da foto virem as marcas gravadas.
 * `invert: false` → material grava ESCURO sobre fundo claro (madeira, couro,
 *                   cortiça, acrílico claro, azulejo branco). Tom normal.
 * `default_dither` espelha o default de dithering por material do One Click.
 * `gamma`/`contrast` são pontos de partida calibrados por material.
 *
 * Os valores de invert para madeira/ardósia/vidro foram CONFIRMADOS por pixel;
 * os demais são inferidos pela física de gravação.
 */
export interface MaterialPreset {
	invert: boolean;
	default_dither: boolean;
	gamma: number;
	contrast: number;
}

export const MATERIAL_PRESETS = {
	wood: { invert: false, default_dither: true, gamma: 1.0, contrast: 1.1 },
	'black slate': {
		invert: true,
		default_dither: true,
		gamma: 1.05,
		contrast: 1.15,
	},
	glass: { invert: true, default_dither: false, gamma: 1.0, contrast: 1.1 },
	acrylic: { invert: false, default_dither: true, gamma: 1.0, contrast: 1.05 },
	leather: { invert: false, default_dither: true, gamma: 1.0, contrast: 1.05 },
	cork: { invert: false, default_dither: true, gamma: 1.0, contrast: 1.05 },
	'andonized aluminum': {
		invert: true,
		default_dither: false,
		gamma: 1.0,
		contrast: 1.1,
	},
	'stainless steel': {
		invert: true,
		default_dither: false,
		gamma: 1.0,
		contrast: 1.1,
	},
	'white tile': {
		invert: false,
		default_dither: true,
		gamma: 1.0,
		contrast: 1.05,
	},
	'white tile painted black': {
		invert: true,
		default_dither: true,
		gamma: 1.05,
		contrast: 1.15,
	},
} as const satisfies Record<string, MaterialPreset>;

export type MaterialKey = keyof typeof MATERIAL_PRESETS;

export const MATERIAL_KEYS = Object.keys(MATERIAL_PRESETS) as [
	MaterialKey,
	...MaterialKey[],
];

export interface LaserPrepResult {
	pngBuffer: Buffer;
	widthMm: number;
	heightMm: number;
	dpi: number;
	pxW: number;
	pxH: number;
}

/** mm → polegada → px no DPI alvo (mesmo arredondamento do `imagr_pipeline.py`). */
function mmToPx(mm: number, dpi: number): number {
	return Math.max(1, Math.round((mm / 25.4) * dpi));
}

/**
 * Motor de fotogravação (Gravação 1-Clique). Porte do pipeline do ImagR:
 *   1. flatten do alpha sobre BRANCO
 *   2. escala de cinza (Rec.709)
 *   3. tom por material: gamma → contraste em torno do meio → inverte se grava claro
 *   4. resize físico (mm→px) com Lanczos (altura pela proporção)
 *   5. dithering (Floyd–Steinberg por padrão) → 1-bit, exceto se noDither
 *   6. exporta PNG com DPI embutido (chunk pHYs)
 *
 * Dithering é SEMPRE o último passo, DEPOIS do resize.
 */
export async function laserPrep(
	buffer: Buffer,
	params: LaserPrepParams,
): Promise<LaserPrepResult> {
	const preset = MATERIAL_PRESETS[params.material as MaterialKey];
	const dpi = params.dpi;
	const widthMm = params.width_mm;

	// Altura recalculada pela proporção da imagem original (como o ImagR faz).
	const meta = await sharp(buffer).metadata();
	const srcW = meta.width ?? 1;
	const srcH = meta.height ?? 1;
	const aspect = srcH / srcW;
	const heightMm = Math.round(widthMm * aspect * 10000) / 10000;

	const pxW = mmToPx(widthMm, dpi);
	const pxH = mmToPx(heightMm, dpi);

	// 1-4: flatten sobre branco → grayscale Rec.709 → tom → resize Lanczos.
	let pipeline = sharp(buffer).flatten({ background: '#ffffff' }).grayscale();

	// gamma só quando > 1 (sharp exige gamma >= 1; gamma=1 é no-op).
	if (preset.gamma > 1) {
		pipeline = pipeline.gamma(preset.gamma);
	}

	// contraste em torno do meio: out = contrast*in + 128*(1-contrast).
	pipeline = pipeline.linear(preset.contrast, 128 * (1 - preset.contrast));

	if (preset.invert) {
		pipeline = pipeline.negate();
	}

	pipeline = pipeline.resize(pxW, pxH, { kernel: 'lanczos3' });

	const { data, info } = await pipeline
		.toColourspace('b-w')
		.raw()
		.toBuffer({ resolveWithObject: true });

	// 5: resolve dithering (noDither tem prioridade; senão default do material).
	const dither = params.noDither === true ? false : preset.default_dither;

	const pixels = dither
		? applyDithering(
				data,
				info.width,
				info.height,
				params.ditherAlgorithm ?? 'floydSteinberg',
				128,
			)
		: data;

	// 6: reconstrói PNG (modo cinza 1 canal) com DPI embutido (pHYs).
	const pngBuffer = await sharp(pixels, {
		raw: { width: info.width, height: info.height, channels: 1 },
	})
		.png()
		.withMetadata({ density: dpi })
		.toBuffer();

	return { pngBuffer, widthMm, heightMm, dpi, pxW, pxH };
}

const DITHER_ALGORITHMS: readonly DitherAlgorithm[] = [
	'floydSteinberg',
	'atkinson',
	'stucki',
	'jarvis',
	'sierra',
	'ordered',
	'halftone',
];

/**
 * Lê os campos multipart (strings) e devolve os parâmetros tipados do motor.
 * Espelha o `parseVectorizeParams` (mesmo padrão de leitura/validação Zod).
 */
export function parseLaserPrepParams(
	fields: Record<string, string>,
): LaserPrepParams {
	const ditherAlgorithm =
		fields.ditherAlgorithm &&
		(DITHER_ALGORITHMS as readonly string[]).includes(fields.ditherAlgorithm)
			? (fields.ditherAlgorithm as DitherAlgorithm)
			: undefined;

	return laserPrepParamsSchema.parse({
		material: fields.material,
		width_mm: fields.width_mm ? Number.parseFloat(fields.width_mm) : undefined,
		dpi: fields.dpi ? Number.parseInt(fields.dpi, 10) : undefined,
		noDither: fields.noDither ? fields.noDither === 'true' : undefined,
		ditherAlgorithm,
	});
}
