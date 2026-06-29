import { z } from 'zod';
import {
	applyLut,
	buildLut,
	clamp8,
	type FxOutput,
	fxFromRaster,
	fxSharp,
	loadRaster,
	luma,
	mapPixels,
	type Raster,
} from '../lib/pixels.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos de AJUSTE (categoria `adjust`) — port do grupo "Adjust" do ImagR
 * (Light / Color / White balance / Detail). Faixas e defaults batem com o §3 do
 * handoff (cada param do shader vira um param do bloco). Saída padrão de filtro:
 * `{ png, pngBase64 }`. Onde dá, usa `sharp` nativo; senão, LUT/raster.
 */

const img = z.instanceof(Buffer);
const num = (def: number) => z.coerce.number().default(def);

/** Parse de cor #rrggbb → [r,g,b] (default preto). */
function hex(c: string | undefined, fallback: [number, number, number]) {
	const m = /^#?([0-9a-f]{6})$/i.exec((c ?? '').trim());
	if (!m) return fallback;
	const n = Number.parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number];
}

/** Açúcar: define um bloco de ajuste com schema {image, ...P}. */
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
		category: 'adjust',
		description,
		paramsSchema: schema as z.ZodType<unknown>,
		run: (_ctx, params) =>
			run(params as z.infer<z.ZodObject<P & { image: typeof img }>>),
	} as ToolBlock;
}

/* ───────────────────────────── Light ───────────────────────────── */

export const brightnessBlock = block(
	'adjust.brightness',
	'Brilho (-1 a 1): clareia/escurece somando luz.',
	{ value: num(0) },
	(p) => fxSharp(p.image, (s) => s.linear(1, p.value * 255)),
);

export const contrastBlock = block(
	'adjust.contrast',
	'Contraste (-1 a 1) em torno do tom médio.',
	{ value: num(0) },
	(p) => {
		const f = 1 + p.value;
		return fxSharp(p.image, (s) => s.linear(f, 128 * (1 - f)));
	},
);

export const exposureBlock = block(
	'adjust.exposure',
	'Exposição em stops (-4 a 4): multiplica a luz por 2^stops.',
	{ stops: num(0) },
	(p) => fxSharp(p.image, (s) => s.linear(2 ** p.stops, 0)),
);

export const gammaBlock = block(
	'adjust.gamma',
	'Gama (0.1 a 3): curva tonal out=(in/255)^(1/gamma).',
	{ value: z.coerce.number().min(0.1).max(3).default(1) },
	async (p) => {
		const inv = 1 / p.value;
		const lut = buildLut((i) => 255 * (i / 255) ** inv);
		const r = await loadRaster(p.image);
		applyLut(r, lut);
		return fxFromRaster(r);
	},
);

export const levelsBlock = block(
	'adjust.levels',
	'Níveis: remapeia [inputMin,inputMax] → [outputMin,outputMax].',
	{
		inputMin: num(0),
		inputMax: num(255),
		outputMin: num(0),
		outputMax: num(255),
	},
	async (p) => {
		const span = Math.max(1, p.inputMax - p.inputMin);
		const oSpan = p.outputMax - p.outputMin;
		const lut = buildLut(
			(i) => ((i - p.inputMin) / span) * oSpan + p.outputMin,
		);
		const r = await loadRaster(p.image);
		applyLut(r, lut);
		return fxFromRaster(r);
	},
);

export const bwLevelsBlock = block(
	'adjust.bwLevels',
	'Níveis P&B: grayscale + estica [input_min,input_max] pra 0..255.',
	{ input_min: num(0), input_max: num(255) },
	(p) => {
		const slope = 255 / Math.max(1, p.input_max - p.input_min);
		return fxSharp(p.image, (s) =>
			s.grayscale().linear(slope, -p.input_min * slope),
		);
	},
);

export const autoLevelsBlock = block(
	'adjust.autoLevels',
	'Níveis automáticos: estica o histograma (com clip de percentil).',
	{ clip: z.coerce.number().min(0).max(10).default(0.5) },
	(p) =>
		fxSharp(p.image, (s) =>
			s.normalise({ lower: p.clip, upper: 100 - p.clip }),
		),
);

export const autoContrastBlock = block(
	'adjust.autoContrast',
	'Contraste automático (normaliza pro range completo).',
	{},
	(p) => fxSharp(p.image, (s) => s.normalize()),
);

export const histogramStretchBlock = block(
	'adjust.histogramStretch',
	'Estica o histograma pro range completo.',
	{},
	(p) => fxSharp(p.image, (s) => s.normalize()),
);

export const autoRefineBlock = block(
	'adjust.autoRefine',
	'Refino local de contraste (CLAHE) por blocos.',
	{
		clipLimit: z.coerce.number().min(0).max(10).default(2),
		tileX: z.coerce.number().min(3).max(512).default(8),
		tileY: z.coerce.number().min(3).max(512).default(8),
	},
	(p) =>
		fxSharp(p.image, (s) =>
			s.clahe({
				width: Math.round(p.tileX),
				height: Math.round(p.tileY),
				maxSlope: Math.max(1, Math.round(p.clipLimit * 3)),
			}),
		),
);

export const thresholdBlock = block(
	'adjust.threshold',
	'Limiar (0..255): binariza P&B no ponto de corte.',
	{ threshold: z.coerce.number().min(0).max(255).default(128) },
	(p) => fxSharp(p.image, (s) => s.grayscale().threshold(p.threshold)),
);

export const adaptiveThresholdBlock = block(
	'adjust.adaptiveThreshold',
	'Limiar adaptativo: compara cada pixel com a média local (raio).',
	{
		radius: z.coerce.number().min(1).max(40).default(6),
		bias: z.coerce.number().min(-0.5).max(0.5).default(0),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h } = r;
		const gray = new Float64Array(w * h);
		for (let i = 0, q = 0; i < w * h; i++, q += 4)
			gray[i] = luma(r.data[q], r.data[q + 1], r.data[q + 2]);
		// Imagem integral pra média de janela O(1).
		const sat = new Float64Array((w + 1) * (h + 1));
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++)
				sat[(y + 1) * (w + 1) + (x + 1)] =
					gray[y * w + x] +
					sat[y * (w + 1) + (x + 1)] +
					sat[(y + 1) * (w + 1) + x] -
					sat[y * (w + 1) + x];
		const rad = Math.round(p.radius);
		const biasV = p.bias * 255;
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const x0 = Math.max(0, x - rad);
				const y0 = Math.max(0, y - rad);
				const x1 = Math.min(w - 1, x + rad);
				const y1 = Math.min(h - 1, y + rad);
				const area = (x1 - x0 + 1) * (y1 - y0 + 1);
				const sum =
					sat[(y1 + 1) * (w + 1) + (x1 + 1)] -
					sat[y0 * (w + 1) + (x1 + 1)] -
					sat[(y1 + 1) * (w + 1) + x0] +
					sat[y0 * (w + 1) + x0];
				const mean = sum / area;
				const v = gray[y * w + x] > mean - biasV ? 255 : 0;
				const q = (y * w + x) * 4;
				r.data[q] = v;
				r.data[q + 1] = v;
				r.data[q + 2] = v;
			}
		}
		return fxFromRaster(r);
	},
);

export const toneCurveBlock = block(
	'adjust.toneCurve',
	'Curva tonal: S de contraste (s) + deslocamento do meio (m).',
	{
		s: z.coerce.number().min(-1).max(1).default(0),
		m: z.coerce.number().min(-1).max(1).default(0),
		strength: z.coerce.number().min(0).max(1).default(1),
	},
	async (p) => {
		const gamma = 2 ** -p.m; // m>0 clareia o meio
		const lut = buildLut((i) => {
			let x = (i / 255) ** gamma;
			// S-curve suave (smoothstep ↔ identidade) escalada por s.
			const sc = 3 * x * x - 2 * x * x * x; // smoothstep(0,1,x)
			x = x + (sc - x) * p.s;
			x = i / 255 + (x - i / 255) * p.strength;
			return x * 255;
		});
		const r = await loadRaster(p.image);
		applyLut(r, lut);
		return fxFromRaster(r);
	},
);

export const highlightsShadowsBlock = block(
	'adjust.highlightsShadows',
	'Sombras/altas-luzes: levanta sombras e/ou recupera luzes.',
	{
		shadows: z.coerce.number().min(-1).max(1).default(0),
		highlights: z.coerce.number().min(-1).max(1).default(0),
		strength: z.coerce.number().min(0).max(1).default(1),
	},
	async (p) => {
		const lut = buildLut((i) => {
			const x = i / 255;
			const ws = (1 - x) * (1 - x);
			const wh = x * x;
			let y = x + p.shadows * 0.5 * ws + p.highlights * 0.5 * wh;
			y = x + (y - x) * p.strength;
			return y * 255;
		});
		const r = await loadRaster(p.image);
		applyLut(r, lut);
		return fxFromRaster(r);
	},
);

export const dehazeBlock = block(
	'adjust.dehaze',
	'Remove névoa (aprox.): reforça contraste e saturação.',
	{
		amount: z.coerce.number().min(0).max(1).default(0.6),
		strength: z.coerce.number().min(0).max(1).default(1),
	},
	(p) => {
		const k = p.amount * p.strength;
		const f = 1 + 0.6 * k;
		return fxSharp(p.image, (s) =>
			s.linear(f, 128 * (1 - f)).modulate({ saturation: 1 + 0.5 * k }),
		);
	},
);

export const curvesBlock = block(
	'adjust.curves',
	'Curva por 3 pontos: preto (low), meio (mid) e branco (high).',
	{
		low: z.coerce.number().min(0).max(255).default(0),
		mid: z.coerce.number().min(1).max(254).default(128),
		high: z.coerce.number().min(0).max(255).default(255),
	},
	async (p) => {
		const lo = p.low;
		const hi = Math.max(p.low + 1, p.high);
		const midN = Math.min(0.99, Math.max(0.01, (p.mid - lo) / (hi - lo)));
		const g = Math.log(0.5) / Math.log(midN);
		const lut = buildLut((i) => {
			const t = Math.min(1, Math.max(0, (i - lo) / (hi - lo)));
			return t ** g * 255;
		});
		const r = await loadRaster(p.image);
		applyLut(r, lut);
		return fxFromRaster(r);
	},
);

/* ──────────────────────── Color / White balance ──────────────────────── */

export const hueBlock = block(
	'adjust.hue',
	'Matiz (-180 a 180 graus): gira a roda de cores.',
	{ degrees: z.coerce.number().min(-180).max(180).default(0) },
	(p) => fxSharp(p.image, (s) => s.modulate({ hue: p.degrees })),
);

export const hslBlock = block(
	'adjust.hsl',
	'HSL: matiz (giro), saturação (mult) e luminosidade (soma).',
	{
		hue: z.coerce.number().min(-0.5).max(0.5).default(0),
		sat: z.coerce.number().min(0).max(3).default(1),
		light: z.coerce.number().min(-0.5).max(0.5).default(0),
	},
	(p) =>
		fxSharp(p.image, (s) =>
			s.modulate({
				hue: p.hue * 360,
				saturation: p.sat,
				lightness: p.light * 100,
			}),
		),
);

export const saturationBlock = block(
	'adjust.saturation',
	'Saturação (-1 a 1).',
	{ value: z.coerce.number().min(-1).max(1).default(0) },
	(p) => fxSharp(p.image, (s) => s.modulate({ saturation: 1 + p.value })),
);

export const vibranceBlock = block(
	'adjust.vibrance',
	'Vibração (-1 a 1): satura mais as cores menos saturadas.',
	{ value: z.coerce.number().min(-1).max(1).default(0) },
	async (p) => {
		const r = await loadRaster(p.image);
		mapPixels(r, (rr, gg, bb, aa) => {
			const mx = Math.max(rr, gg, bb);
			const mn = Math.min(rr, gg, bb);
			const sat = mx === 0 ? 0 : (mx - mn) / mx;
			const amt = p.value * (1 - sat); // protege o que já é saturado
			const l = luma(rr, gg, bb);
			return [
				clamp8(rr + (rr - l) * amt),
				clamp8(gg + (gg - l) * amt),
				clamp8(bb + (bb - l) * amt),
				aa,
			];
		});
		return fxFromRaster(r);
	},
);

export const temperatureBlock = block(
	'adjust.temperature',
	'Temperatura (-1 frio a 1 quente): desloca R↔B.',
	{ value: z.coerce.number().min(-1).max(1).default(0) },
	(p) => {
		const d = p.value * 40;
		return fxSharp(p.image, (s) => s.linear([1, 1, 1], [d, 0, -d]));
	},
);

export const tintBlock = block(
	'adjust.tint',
	'Tonalidade (-1 verde a 1 magenta): desloca o canal verde.',
	{ value: z.coerce.number().min(-1).max(1).default(0) },
	(p) => {
		const d = p.value * 40;
		return fxSharp(p.image, (s) => s.linear([1, 1, 1], [0, -d, 0]));
	},
);

export const channelMixerBlock = block(
	'adjust.channelMixer',
	'Mixer de canais: recombina R,G,B (matriz 3×3).',
	{
		rr: num(1),
		rg: num(0),
		rb: num(0),
		gr: num(0),
		gg: num(1),
		gb: num(0),
		br: num(0),
		bg: num(0),
		bb: num(1),
	},
	(p) =>
		fxSharp(p.image, (s) =>
			s.recomb([
				[p.rr, p.rg, p.rb],
				[p.gr, p.gg, p.gb],
				[p.br, p.bg, p.bb],
			]),
		),
);

export const gradientMapBlock = block(
	'adjust.gradientMap',
	'Mapa de gradiente: mapeia o tom entre duas cores.',
	{
		shadowColor: z.string().default('#000000'),
		highlightColor: z.string().default('#ffffff'),
	},
	async (p) => {
		const lo = hex(p.shadowColor, [0, 0, 0]);
		const hi = hex(p.highlightColor, [255, 255, 255]);
		const r = await loadRaster(p.image);
		mapPixels(r, (rr, gg, bb, aa) => {
			const t = luma(rr, gg, bb) / 255;
			return [
				clamp8(lo[0] + (hi[0] - lo[0]) * t),
				clamp8(lo[1] + (hi[1] - lo[1]) * t),
				clamp8(lo[2] + (hi[2] - lo[2]) * t),
				aa,
			];
		});
		return fxFromRaster(r);
	},
);

export const monochromeBlock = block(
	'adjust.monochrome',
	'Monocromático: grayscale com leve contraste de filme.',
	{ filmContrast: z.coerce.number().min(0).max(1).default(0.12) },
	(p) => {
		const f = 1 + p.filmContrast;
		return fxSharp(p.image, (s) => s.grayscale().linear(f, 128 * (1 - f)));
	},
);

export const posterizeBlock = block(
	'adjust.posterize',
	'Posterização: reduz pra N níveis por canal.',
	{ levels: z.coerce.number().int().min(2).max(32).default(6) },
	async (p) => {
		const n = p.levels - 1;
		const lut = buildLut((i) =>
			Math.round((Math.round((i / 255) * n) / n) * 255),
		);
		const r = await loadRaster(p.image);
		applyLut(r, lut);
		return fxFromRaster(r);
	},
);

export const textureBlock = block(
	'adjust.texture',
	'Textura (aprox.): realça micro-detalhe (unsharp).',
	{
		amount: z.coerce.number().min(-1).max(1).default(0.25),
		radius: z.coerce.number().min(0.5).max(6).default(1.2),
	},
	(p) =>
		fxSharp(p.image, (s) =>
			s.sharpen({ sigma: p.radius, m1: 0, m2: Math.max(0, p.amount) * 3 }),
		),
);

export const grayscaleBlock = block(
	'adjust.grayscale',
	'Escala de cinza (Rec.709).',
	{},
	(p) => fxSharp(p.image, (s) => s.grayscale()),
);

/** Todos os blocos de ajuste, pra registro no index. */
export const adjustBlocks: ToolBlock[] = [
	brightnessBlock,
	contrastBlock,
	exposureBlock,
	gammaBlock,
	levelsBlock,
	bwLevelsBlock,
	autoLevelsBlock,
	autoContrastBlock,
	histogramStretchBlock,
	autoRefineBlock,
	thresholdBlock,
	adaptiveThresholdBlock,
	toneCurveBlock,
	highlightsShadowsBlock,
	dehazeBlock,
	curvesBlock,
	hueBlock,
	hslBlock,
	saturationBlock,
	vibranceBlock,
	temperatureBlock,
	tintBlock,
	channelMixerBlock,
	gradientMapBlock,
	monochromeBlock,
	posterizeBlock,
	textureBlock,
	grayscaleBlock,
];
