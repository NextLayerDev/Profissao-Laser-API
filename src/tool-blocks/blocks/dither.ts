import { z } from 'zod';
import { applyDithering, type DitherAlgorithm } from '../../lib/dithering.js';
import {
	type FxOutput,
	fxFromRaster,
	gray1ToRaster,
	loadRaster,
	toGray1,
} from '../lib/pixels.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos de DITHERING (categoria `dither`) — binarização P&B (e few-levels).
 * Padrão: `loadRaster → toGray1 → algoritmo → gray1ToRaster → fxFromRaster`.
 * Os clássicos (Floyd-Steinberg, Atkinson, Jarvis, Stucki, Sierra, Bayer8,
 * halftone) reusam `applyDithering` do `lib/dithering`; os demais (Sierra-2,
 * Sierra-Lite, Burkes, Bayer4, blue-noise, multi-nível) usam um helper local de
 * difusão de erro / ordered. Saída padrão de filtro: `{ png, pngBase64 }`.
 */

const img = z.instanceof(Buffer);
const threshParam = z.coerce.number().min(0).max(255).default(128);

/** Açúcar: define um bloco de dithering com schema {image, ...P}. */
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
		category: 'dither',
		description,
		paramsSchema: schema as z.ZodType<unknown>,
		run: (_ctx, params) =>
			run(params as z.infer<z.ZodObject<P & { image: typeof img }>>),
	} as ToolBlock;
}

/* ──────────────────────── helpers de difusão/ordered ──────────────────────── */

/** Entrada de kernel de difusão: [dx, dy, peso] (peso já normalizado /divisor). */
type DiffEntry = [number, number, number];

/**
 * Difusão de erro genérica em N níveis (binário = 2). Trabalha num Float32Array
 * do gray, varre em raster e espalha o erro de quantização pelo kernel. Devolve
 * 1 canal (0..255) já quantizado.
 */
function errorDiffuse(
	gray: Buffer,
	w: number,
	h: number,
	kernel: DiffEntry[],
	levels = 2,
	threshold = 128,
): Buffer {
	const buf = new Float32Array(w * h);
	for (let i = 0; i < gray.length; i++) buf[i] = gray[i];
	const out = Buffer.allocUnsafe(w * h);
	const step = levels > 2 ? 255 / (levels - 1) : 0;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const idx = y * w + x;
			const oldVal = Math.max(0, Math.min(255, buf[idx]));
			// 2 níveis usa threshold; N níveis quantiza pelo step.
			const newVal =
				levels > 2
					? Math.round(oldVal / step) * step
					: oldVal < threshold
						? 0
						: 255;
			out[idx] = newVal;
			const err = oldVal - newVal;
			for (const [dx, dy, wgt] of kernel) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx >= 0 && nx < w && ny >= 0 && ny < h)
					buf[ny * w + nx] += err * wgt;
			}
		}
	}
	return out;
}

/** Ordered dithering por matriz (compara gray > matriz/max*255). */
function orderedMatrix(
	gray: Buffer,
	w: number,
	h: number,
	matrix: number[][],
	max: number,
): Buffer {
	const out = Buffer.allocUnsafe(w * h);
	const mh = matrix.length;
	const mw = matrix[0].length;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const t = (matrix[y % mh][x % mw] / max) * 255;
			out[y * w + x] = gray[y * w + x] > t ? 255 : 0;
		}
	}
	return out;
}

/** Atalho: roda um algoritmo de `lib/dithering` e devolve a saída padrão. */
async function ditherWith(
	image: Buffer,
	algo: DitherAlgorithm,
	threshold: number,
): Promise<FxOutput> {
	const r = await loadRaster(image);
	const g = toGray1(r);
	const bin = applyDithering(g, r.width, r.height, algo, threshold);
	return fxFromRaster(gray1ToRaster(bin, r.width, r.height));
}

/** Atalho: roda uma difusão de erro com kernel local e devolve saída padrão. */
async function diffuseWith(
	image: Buffer,
	kernel: DiffEntry[],
	levels: number,
	threshold: number,
): Promise<FxOutput> {
	const r = await loadRaster(image);
	const g = toGray1(r);
	const bin = errorDiffuse(g, r.width, r.height, kernel, levels, threshold);
	return fxFromRaster(gray1ToRaster(bin, r.width, r.height));
}

/* ─────────────────────── clássicos (reusam lib/dithering) ─────────────────────── */

export const floydSteinbergBlock = block(
	'dither.floydSteinberg',
	'Floyd-Steinberg: difusão de erro padrão (4 vizinhos).',
	{ threshold: threshParam },
	(p) => ditherWith(p.image, 'floydSteinberg', p.threshold),
);

export const atkinsonBlock = block(
	'dither.atkinson',
	'Atkinson: alto contraste, ótimo p/ laser (difunde 75% do erro).',
	{ threshold: threshParam },
	(p) => ditherWith(p.image, 'atkinson', p.threshold),
);

export const jarvisBlock = block(
	'dither.jarvis',
	'Jarvis-Judice-Ninke: kernel largo, gradientes suaves.',
	{ threshold: threshParam },
	(p) => ditherWith(p.image, 'jarvis', p.threshold),
);

export const stuckiBlock = block(
	'dither.stucki',
	'Stucki: alta qualidade p/ fotos (12 vizinhos).',
	{ threshold: threshParam },
	(p) => ditherWith(p.image, 'stucki', p.threshold),
);

export const sierraBlock = block(
	'dither.sierra',
	'Sierra (full): bom equilíbrio qualidade/velocidade.',
	{ threshold: threshParam },
	(p) => ditherWith(p.image, 'sierra', p.threshold),
);

export const bayer8Block = block(
	'dither.bayer8',
	'Bayer 8×8: ordered dithering estruturado (ignora threshold).',
	{ threshold: threshParam },
	(p) => ditherWith(p.image, 'ordered', p.threshold),
);

export const halftoneBlock = block(
	'dither.halftone',
	'Halftone: pontos tipo jornal (matriz radial, ignora threshold).',
	{ threshold: threshParam },
	(p) => ditherWith(p.image, 'halftone', p.threshold),
);

/* ─────────────────────── difusão de erro (kernels locais) ─────────────────────── */

export const sierra2Block = block(
	'dither.sierra2',
	'Sierra-2-row: difusão de erro em 2 linhas (divisor 16).',
	{ threshold: threshParam },
	(p) =>
		diffuseWith(
			p.image,
			[
				[1, 0, 4 / 16],
				[2, 0, 3 / 16],
				[-2, 1, 1 / 16],
				[-1, 1, 2 / 16],
				[0, 1, 3 / 16],
				[1, 1, 2 / 16],
				[2, 1, 1 / 16],
			],
			2,
			p.threshold,
		),
);

export const sierraLiteBlock = block(
	'dither.sierraLite',
	'Sierra-Lite: difusão de erro mínima (divisor 4, rápido).',
	{ threshold: threshParam },
	(p) =>
		diffuseWith(
			p.image,
			[
				[1, 0, 2 / 4],
				[-1, 1, 1 / 4],
				[0, 1, 1 / 4],
			],
			2,
			p.threshold,
		),
);

export const burkesBlock = block(
	'dither.burkes',
	'Burkes: difusão de erro em 2 linhas (divisor 32).',
	{ threshold: threshParam },
	(p) =>
		diffuseWith(
			p.image,
			[
				[1, 0, 8 / 32],
				[2, 0, 4 / 32],
				[-2, 1, 2 / 32],
				[-1, 1, 4 / 32],
				[0, 1, 8 / 32],
				[1, 1, 4 / 32],
				[2, 1, 2 / 32],
			],
			2,
			p.threshold,
		),
);

/* ─────────────────────────── ordered / ruído ─────────────────────────── */

/** Matriz Bayer 4×4 (ordered). */
const BAYER_4X4 = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
];

export const bayer4Block = block(
	'dither.bayer4',
	'Bayer 4×4: ordered dithering compacto (ignora threshold).',
	{ threshold: threshParam },
	async (p) => {
		const r = await loadRaster(p.image);
		const g = toGray1(r);
		const bin = orderedMatrix(g, r.width, r.height, BAYER_4X4, 16);
		return fxFromRaster(gray1ToRaster(bin, r.width, r.height));
	},
);

export const blueNoiseBlock = block(
	'dither.blueNoise',
	'Blue-noise (aprox.): limiar por ruído pseudo-aleatório determinístico.',
	{ strength: z.coerce.number().min(0).max(1).default(1) },
	async (p) => {
		const r = await loadRaster(p.image);
		const g = toGray1(r);
		const { width: w, height: h } = r;
		const out = Buffer.allocUnsafe(w * h);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				// hash determinístico por pixel → frac(sin·k) em 0..1.
				const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
				const noise = (s - Math.floor(s)) * 255;
				const t = noise * p.strength + 128 * (1 - p.strength);
				out[y * w + x] = g[y * w + x] > t ? 255 : 0;
			}
		}
		return fxFromRaster(gray1ToRaster(out, w, h));
	},
);

export const errorDiffusionBlock = block(
	'dither.errorDiffusion',
	'Difusão de erro multinível: Floyd-Steinberg quantizando em N níveis.',
	{ levels: z.coerce.number().int().min(2).max(8).default(2) },
	(p) =>
		diffuseWith(
			p.image,
			[
				[1, 0, 7 / 16],
				[-1, 1, 3 / 16],
				[0, 1, 5 / 16],
				[1, 1, 1 / 16],
			],
			p.levels,
			128,
		),
);

/** Todos os blocos de dithering, pra registro no index. */
export const ditherBlocks: ToolBlock[] = [
	floydSteinbergBlock,
	atkinsonBlock,
	jarvisBlock,
	stuckiBlock,
	sierraBlock,
	bayer8Block,
	halftoneBlock,
	sierra2Block,
	sierraLiteBlock,
	burkesBlock,
	bayer4Block,
	blueNoiseBlock,
	errorDiffusionBlock,
];
