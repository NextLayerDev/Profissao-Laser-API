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

/**
 * Teto de pixels do raster de SAÍDA (100 MP = 10.000×10.000). Defesa contra
 * OOM: o resize aloca px independentemente do tamanho do upload, então uma
 * combinação width_mm×dpi (ou aspecto extremo) poderia estourar a memória.
 * 100 MP cobre folgado o uso real (1 m × 1 m @ 254 DPI ≈ 89 MP).
 */
const MAX_OUTPUT_PIXELS = 100 * 1_000_000;

/** mm → polegada → px no DPI alvo (mesmo arredondamento do `imagr_pipeline.py`). */
export function mmToPx(mm: number, dpi: number): number {
	return Math.max(1, Math.round((mm / 25.4) * dpi));
}

/** Acima disso (px na origem) a limpeza de fundo é pulada (memória do flood-fill). */
const MAX_BG_CLEANUP_PIXELS = 40 * 1_000_000;

/**
 * Detecta o FUNDO por flood-fill 4-conexo a partir das BORDAS, com LIMIAR
 * ADAPTATIVO: o limiar é fixado logo abaixo da luminância dominante da borda
 * (mediana − margin), e tudo que for >= limiar e conectado à borda vira fundo.
 *
 * Por que limiar (e não seguir gradiente): um objeto 3D tem sombreado suave;
 * seguir o gradiente "entraria" no objeto e o apagaria. O limiar absoluto
 * preserva o objeto (mais escuro que o limiar) e alcança os cantos do fundo
 * (que estão no nível do fundo). Áreas claras INTERNAS do sujeito também ficam
 * preservadas — não são alcançadas a partir da borda. `margin` (do slider)
 * controla quão escuro o fundo pode ser pra ainda ser limpo. Sem IA.
 *
 * Devolve Uint8Array (1 = fundo) ou null se nada — ou quase tudo — for marcado.
 */
function detectBackground(
	gray: Buffer | Uint8Array,
	width: number,
	height: number,
	margin: number,
): Uint8Array | null {
	const n = width * height;
	if (n > MAX_BG_CLEANUP_PIXELS) return null; // imagem grande demais — pula

	// Mediana da borda = luminância dominante do fundo (robusta ao sujeito que
	// toca a borda, que costuma ser minoria).
	const border: number[] = [];
	for (let x = 0; x < width; x++) {
		border.push(gray[x] as number);
		border.push(gray[(height - 1) * width + x] as number);
	}
	for (let y = 1; y < height - 1; y++) {
		border.push(gray[y * width] as number);
		border.push(gray[y * width + width - 1] as number);
	}
	border.sort((a, b) => a - b);
	const bgMedian = border[border.length >> 1];
	const threshold = bgMedian - margin;

	const isBg = new Uint8Array(n);
	const stack = new Int32Array(n);
	let sp = 0;
	let marked = 0;
	const seed = (idx: number) => {
		if (isBg[idx] === 0 && (gray[idx] as number) >= threshold) {
			isBg[idx] = 1;
			stack[sp++] = idx;
			marked++;
		}
	};
	for (let x = 0; x < width; x++) {
		seed(x);
		seed((height - 1) * width + x);
	}
	for (let y = 1; y < height - 1; y++) {
		seed(y * width);
		seed(y * width + width - 1);
	}
	while (sp > 0) {
		const idx = stack[--sp];
		const x = idx % width;
		const y = (idx - x) / width;
		if (x > 0) seed(idx - 1);
		if (x < width - 1) seed(idx + 1);
		if (y > 0) seed(idx - width);
		if (y < height - 1) seed(idx + width);
	}
	// Marcou quase tudo → vazou pro sujeito; descarta por segurança.
	return marked > 0 && marked < n * 0.97 ? isBg : null;
}

/**
 * Motor de fotogravação (Gravação 1-Clique). Porte do pipeline do ImagR:
 *   1. flatten do alpha sobre BRANCO
 *   2. escala de cinza (Rec.709)
 *   3. (opcional) limpa o fundo claro por flood-fill das bordas
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

	// Teto de megapixels do raster de saída: defesa contra OOM/DoS. pxW/pxH vêm de
	// width_mm/dpi (já limitados no schema), mas pxH também depende do aspecto da
	// imagem; um aspecto extremo ainda poderia explodir. Rejeita antes do resize.
	if (pxW * pxH > MAX_OUTPUT_PIXELS) {
		throw new Error(
			`Saída grande demais: ${pxW}x${pxH}px excede o teto de ${
				MAX_OUTPUT_PIXELS / 1_000_000
			} MP. Reduza a largura (mm) ou o DPI.`,
		);
	}

	// ── 1: flatten sobre BRANCO → grayscale Rec.709, na RESOLUÇÃO ORIGINAL.
	// (1 canal, raw — o tom é aplicado manualmente para bater 1:1 com a referência.)
	const { data: gray, info: grayInfo } = await sharp(buffer)
		.flatten({ background: '#ffffff' })
		.grayscale()
		.toColourspace('b-w')
		.raw()
		.toBuffer({ resolveWithObject: true });

	// ── 2: TOM por material aplicado ANTES do resize (porte 1:1 do apply_tone):
	//   gamma     → out = (in/255) ^ (1/gamma)         (curva tonal única)
	//   contraste → out = (g - 0.5) * contrast + 0.5   (em torno do meio)
	//   clamp [0,1] → *255 → inverte se o material grava claro sobre escuro.
	// O sharp NÃO serve aqui: .gamma() é um round-trip encode/decode que zera o
	// efeito tonal, e .linear()/.negate() rodariam DEPOIS do resize (ordem interna
	// fixa). Por isso o tom é feito na mão, sobre o raster em resolução original.
	const applyGamma = preset.gamma !== 1;
	const invGamma = 1 / preset.gamma;
	const c = preset.contrast;
	// Curva de tom de um pixel (reutilizada pra achar o "branco do material").
	const toneOf = (v255: number): number => {
		let g = v255 / 255;
		if (applyGamma) g = g ** invGamma;
		g = (g - 0.5) * c + 0.5;
		g = g < 0 ? 0 : g > 1 ? 1 : g;
		g *= 255;
		if (preset.invert) g = 255 - g;
		return Math.round(g);
	};

	// Limpeza de fundo claro (opcional): pixels de fundo (quase-brancos conectados
	// à borda) viram o "branco do material" — o que um pixel branco vira após
	// tom+inversão: 255 nos materiais normais, 0 nos invertidos. Resultado: fundo
	// sólido, sem o granulado do dithering, preservando o sujeito.
	const bgMask =
		params.cleanBackground === true
			? detectBackground(
					gray,
					grayInfo.width,
					grayInfo.height,
					params.bgMargin ?? 16,
				)
			: null;
	const blankValue = toneOf(255);

	const toned = Buffer.allocUnsafe(gray.length);
	for (let i = 0; i < gray.length; i++) {
		toned[i] = bgMask?.[i] ? blankValue : toneOf(gray[i]);
	}

	// ── 3: resize físico (mm→px) com Lanczos, sobre o raster JÁ tonalizado.
	const { data, info } = await sharp(toned, {
		raw: { width: grayInfo.width, height: grayInfo.height, channels: 1 },
	})
		.resize(pxW, pxH, { kernel: 'lanczos3' })
		.toColourspace('b-w')
		.raw()
		.toBuffer({ resolveWithObject: true });

	// 4: resolve dithering (noDither tem prioridade; senão default do material).
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
		cleanBackground: fields.cleanBackground
			? fields.cleanBackground === 'true'
			: undefined,
		bgMargin: fields.bgMargin
			? Number.parseInt(fields.bgMargin, 10)
			: undefined,
	});
}
