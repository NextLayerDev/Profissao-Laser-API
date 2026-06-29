import { z } from 'zod';
import {
	clamp8,
	convolve,
	type FxOutput,
	fxFromRaster,
	fxSharp,
	gray1ToRaster,
	loadRaster,
	luma,
	mapPixels,
	type Raster,
} from '../lib/pixels.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos de BORDA + DESFOQUE/RUÍDO + MÁSCARA (categoria `filter`) — port dos
 * grupos "Edge", "Blur", "Detail", "FX" e "Mask" do ImagR. Faixas/defaults batem
 * com o spec do handoff. Saída padrão de filtro: `{ png, pngBase64 }`. Onde dá,
 * usa `sharp` nativo (`fxSharp`); senão, convolução/raster. Vários itens são
 * APROXIMAÇÕES dos shaders WebGL originais (marcados com "aprox." na descrição).
 */

const img = z.instanceof(Buffer);
const _num = (def: number) => z.coerce.number().default(def);
/** Bool tolerante a "true"/"1"/1 vindos de form/JSON. */
const bool = (def: boolean) =>
	z
		.preprocess(
			(v) => v === true || v === 'true' || v === '1' || v === 1,
			z.boolean(),
		)
		.default(def);

/** Açúcar: define um bloco de filtro com schema {image, ...P}. */
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
		category: 'filter',
		description,
		paramsSchema: schema as z.ZodType<unknown>,
		run: (_ctx, params) =>
			run(params as z.infer<z.ZodObject<P & { image: typeof img }>>),
	} as ToolBlock;
}

/* ───────────────────────── helpers internos ───────────────────────── */

/** Kernel gaussiano 5×5 (soma 256), usado em high-pass/canny. */
const GAUSS5 = [
	1, 4, 6, 4, 1, 4, 16, 24, 16, 4, 6, 24, 36, 24, 6, 4, 16, 24, 16, 4, 1, 4, 6,
	4, 1,
];

/** Float gray (Rec.709) do raster, length = w*h. */
function grayFloat(r: Raster): Float64Array {
	const n = r.width * r.height;
	const g = new Float64Array(n);
	const d = r.data;
	for (let i = 0, q = 0; i < n; i++, q += 4)
		g[i] = luma(d[q], d[q + 1], d[q + 2]);
	return g;
}

/** Convolução 3×3 sobre um campo gray (Float), borda replicada. */
function conv3Gray(
	g: Float64Array,
	w: number,
	h: number,
	k: number[],
): Float64Array {
	const out = new Float64Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let s = 0;
			let idx = 0;
			for (let ky = -1; ky <= 1; ky++) {
				let yy = y + ky;
				yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
				for (let kx = -1; kx <= 1; kx++) {
					let xx = x + kx;
					xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
					s += g[yy * w + xx] * k[idx++];
				}
			}
			out[y * w + x] = s;
		}
	}
	return out;
}

const SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
const SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 1, 1];

/** Magnitude Sobel (Float, não normalizada) a partir de um campo gray. */
function sobelMag(g: Float64Array, w: number, h: number): Float64Array {
	const gx = conv3Gray(g, w, h, SOBEL_X);
	const gy = conv3Gray(g, w, h, SOBEL_Y);
	const mag = new Float64Array(w * h);
	for (let i = 0; i < mag.length; i++)
		mag[i] = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
	return mag;
}

/** Borra um campo gray N vezes com box 3×3 (aprox. de gaussiano por sigma). */
function blurGrayBox(
	g: Float64Array,
	w: number,
	h: number,
	passes: number,
): Float64Array {
	const box = [1, 1, 1, 1, 1, 1, 1, 1, 1].map((v) => v / 9);
	let cur = g;
	for (let p = 0; p < passes; p++) cur = conv3Gray(cur, w, h, box);
	return cur;
}

/* ───────────────────────────── Edge ───────────────────────────── */

export const edgeSobelBlock = block(
	'edge.sobel',
	'Bordas Sobel: magnitude do gradiente (sqrt(gx²+gy²)) sobre o tom.',
	{},
	async (p) => {
		const r = await loadRaster(p.image);
		const g = grayFloat(r);
		const mag = sobelMag(g, r.width, r.height);
		const out = Buffer.allocUnsafe(r.width * r.height);
		for (let i = 0; i < out.length; i++) out[i] = clamp8(mag[i]);
		return fxFromRaster(gray1ToRaster(out, r.width, r.height));
	},
);

export const edgeOutlineBlock = block(
	'edge.outline',
	'Contorno: kernel laplaciano 3×3 [-1…8…-1] (realça bordas).',
	{},
	async (p) => {
		const r = await loadRaster(p.image);
		const out = convolve(r, [-1, -1, -1, -1, 8, -1, -1, -1, -1], 3, 3, 1, 0);
		return fxFromRaster(out);
	},
);

export const edgeHighPassBlock = block(
	'edge.highPass',
	'Passa-alta: original − blur gaussiano (5×5), recentrado em 128.',
	{},
	async (p) => {
		const r = await loadRaster(p.image);
		const blur = convolve(r, GAUSS5, 5, 5, 256, 0);
		const o = r.data;
		const b = blur.data;
		for (let q = 0; q < o.length; q += 4) {
			o[q] = clamp8(128 + o[q] - b[q]);
			o[q + 1] = clamp8(128 + o[q + 1] - b[q + 1]);
			o[q + 2] = clamp8(128 + o[q + 2] - b[q + 2]);
		}
		return fxFromRaster(r);
	},
);

export const edgeDetectBlock = block(
	'edge.edgeDetect',
	'Detecção de bordas: Sobel normalizado + limiar, intensidade e inversão.',
	{
		strength: z.coerce.number().min(0).max(1).default(1),
		threshold: z.coerce.number().min(0).max(1).default(0.2),
		invert: bool(false),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h } = r;
		const mag = sobelMag(grayFloat(r), w, h);
		let max = 1;
		for (let i = 0; i < mag.length; i++) if (mag[i] > max) max = mag[i];
		const thr = p.threshold * 255;
		const out = Buffer.allocUnsafe(w * h);
		for (let i = 0; i < out.length; i++) {
			let v = (mag[i] / max) * 255; // normaliza 0..255
			v = v < thr ? 0 : v; // limiar
			v *= p.strength; // intensidade
			out[i] = clamp8(p.invert ? 255 - v : v);
		}
		return fxFromRaster(gray1ToRaster(out, w, h));
	},
);

export const cannyBlock = block(
	'edge.canny',
	'Canny (aprox.): blur gaussiano + Sobel + duplo limiar (histerese simples).',
	{
		strength: z.coerce.number().min(0).max(1).default(1),
		low: z.coerce.number().min(0).max(1).default(0.12),
		high: z.coerce.number().min(0).max(1).default(0.28),
		blur: z.coerce.number().min(0).max(1).default(0.35),
		invert: bool(false),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h } = r;
		// blur ~ sigma*3: aprox. por N passes de box 3×3.
		const passes = Math.max(0, Math.round(p.blur * 3 * 1.5));
		const g = blurGrayBox(grayFloat(r), w, h, passes);
		const mag = sobelMag(g, w, h);
		let max = 1;
		for (let i = 0; i < mag.length; i++) if (mag[i] > max) max = mag[i];
		const lo = p.low * max;
		const hi = p.high * max;
		// Duplo limiar: forte=255; fraco vira forte se tem vizinho forte (histerese simples).
		const lbl = new Uint8Array(w * h); // 0 fraco-descartado, 1 fraco, 2 forte
		for (let i = 0; i < lbl.length; i++)
			lbl[i] = mag[i] >= hi ? 2 : mag[i] >= lo ? 1 : 0;
		const out = Buffer.alloc(w * h);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const i = y * w + x;
				let keep = lbl[i] === 2;
				if (lbl[i] === 1) {
					for (let dy = -1; dy <= 1 && !keep; dy++)
						for (let dx = -1; dx <= 1; dx++) {
							const yy = y + dy;
							const xx = x + dx;
							if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
							if (lbl[yy * w + xx] === 2) {
								keep = true;
								break;
							}
						}
				}
				let v = keep ? 255 * p.strength : 0;
				if (p.invert) v = 255 - v;
				out[i] = clamp8(v);
			}
		}
		return fxFromRaster(gray1ToRaster(out, w, h));
	},
);

/* ──────────────────────── Blur / Ruído / Misc ──────────────────────── */

export const blurBoxBlock = block(
	'blur.box',
	'Desfoque box (aprox. ≈ gaussiano via sharp.blur).',
	{ radius: z.coerce.number().min(1).max(50).default(3) },
	(p) => fxSharp(p.image, (s) => s.blur(p.radius)),
);

export const blurGaussianBlock = block(
	'blur.gaussian',
	'Desfoque gaussiano (sigma).',
	{ sigma: z.coerce.number().min(0.3).max(50).default(3) },
	(p) => fxSharp(p.image, (s) => s.blur(p.sigma)),
);

export const blurMotionBlock = block(
	'blur.motion',
	'Desfoque de movimento: convolução com linha no ângulo (distância px).',
	{
		angle: z.coerce.number().min(0).max(360).default(0),
		distance: z.coerce.number().min(0).max(100).default(20),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const dist = Math.round(p.distance);
		if (dist <= 0) return fxFromRaster(r);
		const size = 2 * dist + 1;
		const kernel = new Array<number>(size * size).fill(0);
		const rad = (p.angle * Math.PI) / 180;
		const dx = Math.cos(rad);
		const dy = Math.sin(rad);
		const c = dist; // centro
		let count = 0;
		// Marca os pixels ao longo da linha que passa pelo centro.
		for (let t = -dist; t <= dist; t++) {
			const x = Math.round(c + dx * t);
			const y = Math.round(c + dy * t);
			if (x < 0 || x >= size || y < 0 || y >= size) continue;
			const idx = y * size + x;
			if (kernel[idx] === 0) {
				kernel[idx] = 1;
				count++;
			}
		}
		if (count === 0) return fxFromRaster(r);
		return fxFromRaster(convolve(r, kernel, size, size, count, 0));
	},
);

export const blurRadialBlock = block(
	'blur.radial',
	'Desfoque radial (aprox.): média de cópias escaladas a partir do centro.',
	{
		strength: z.coerce.number().min(0).max(1).default(0.3),
		centerX: z.coerce.number().min(0).max(1).default(0.5),
		centerY: z.coerce.number().min(0).max(1).default(0.5),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h, data: src } = r;
		if (p.strength <= 0) return fxFromRaster(r);
		const cx = p.centerX * (w - 1);
		const cy = p.centerY * (h - 1);
		const samples = 6;
		const out = new Uint8ClampedArray(src.length);
		// Para cada pixel, média de N amostras ao longo da reta até o centro (zoom blur).
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				let sr = 0;
				let sg = 0;
				let sb = 0;
				let sa = 0;
				for (let s = 0; s < samples; s++) {
					const t = (s / (samples - 1)) * p.strength * 0.4;
					const sx = Math.round(x + (cx - x) * t);
					const sy = Math.round(y + (cy - y) * t);
					const q = (sy * w + sx) * 4;
					sr += src[q];
					sg += src[q + 1];
					sb += src[q + 2];
					sa += src[q + 3];
				}
				const o = (y * w + x) * 4;
				out[o] = sr / samples;
				out[o + 1] = sg / samples;
				out[o + 2] = sb / samples;
				out[o + 3] = sa / samples;
			}
		}
		return fxFromRaster({ data: out, width: w, height: h, channels: 4 });
	},
);

export const blurSurfaceBlock = block(
	'blur.surface',
	'Desfoque de superfície (aprox. bilateral via filtro de mediana).',
	{
		radius: z.coerce.number().min(0).max(10).default(5),
		threshold: z.coerce.number().min(0.01).max(1).default(0.2),
	},
	(p) => fxSharp(p.image, (s) => s.median(Math.max(1, Math.round(p.radius)))),
);

/* ──────────────────────────── Detail ──────────────────────────── */

export const unsharpMaskBlock = block(
	'detail.unsharpMask',
	'Máscara de nitidez (unsharp) padrão.',
	{},
	(p) => fxSharp(p.image, (s) => s.sharpen({ sigma: 1, m1: 1, m2: 2 })),
);

export const sharpenBlock = block(
	'detail.sharpen',
	'Nitidez por intensidade (0..2).',
	{ strength: z.coerce.number().min(0).max(2).default(0.5) },
	(p) => fxSharp(p.image, (s) => s.sharpen({ sigma: 1, m2: p.strength * 3 })),
);

export const denoiseBlock = block(
	'detail.denoise',
	'Redução de ruído (aprox.): filtro de mediana proporcional.',
	{ strength: z.coerce.number().min(0).max(1).default(1) },
	(p) => fxSharp(p.image, (s) => s.median(p.strength > 0.5 ? 3 : 1)),
);

/* ───────────────────────────── FX ───────────────────────────── */

export const noiseBlock = block(
	'fx.noise',
	'Ruído mono (aprox.): adiciona ±amount·255 determinístico por pixel.',
	{ amount: z.coerce.number().min(0).max(1).default(0.2) },
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w } = r;
		const amt = p.amount * 255;
		let i = 0;
		mapPixels(r, (rr, gg, bb, aa) => {
			const x = i % w;
			const y = (i / w) | 0;
			i++;
			// Hash determinístico por coordenada → [-1,1].
			const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
			const n = ((s - Math.floor(s)) * 2 - 1) * amt;
			return [clamp8(rr + n), clamp8(gg + n), clamp8(bb + n), aa];
		});
		return fxFromRaster(r);
	},
);

export const filmGrainBlock = block(
	'fx.filmGrain',
	'Grão de filme (aprox.): ruído mono sutil modulado pela luminância.',
	{ amount: z.coerce.number().min(0).max(1).default(0.08) },
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w } = r;
		const amt = p.amount * 255;
		let i = 0;
		mapPixels(r, (rr, gg, bb, aa) => {
			const x = i % w;
			const y = (i / w) | 0;
			i++;
			const s = Math.sin(x * 39.346 + y * 11.135) * 24634.6345;
			// Mais grão nos meios-tons (modula por luminância).
			const lum = luma(rr, gg, bb) / 255;
			const mod = 1 - Math.abs(lum - 0.5) * 2;
			const n = ((s - Math.floor(s)) * 2 - 1) * amt * mod;
			return [clamp8(rr + n), clamp8(gg + n), clamp8(bb + n), aa];
		});
		return fxFromRaster(r);
	},
);

export const embossBlock = block(
	'fx.emboss',
	'Relevo direcional: convolução emboss + bias 128, misturado com o original.',
	{
		blend: z.coerce.number().min(0).max(1).default(1),
		amount: z.coerce.number().min(0).max(8).default(3),
		angle: z.coerce.number().min(0).max(6.28).default(0.785),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const dx = Math.cos(p.angle);
		const dy = Math.sin(p.angle);
		const a = p.amount;
		// Kernel 3×3 direcional: gradiente +/- nos cantos opostos.
		const kernel = [
			-dx * a - dy * a,
			-dy * a,
			dx * a - dy * a,
			-dx * a,
			1,
			dx * a,
			-dx * a + dy * a,
			dy * a,
			dx * a + dy * a,
		];
		const emb = convolve(r, kernel, 3, 3, 1, 128);
		// Mistura emboss × original por blend.
		const o = r.data;
		const e = emb.data;
		for (let q = 0; q < o.length; q += 4) {
			o[q] = clamp8(o[q] + (e[q] - o[q]) * p.blend);
			o[q + 1] = clamp8(o[q + 1] + (e[q + 1] - o[q + 1]) * p.blend);
			o[q + 2] = clamp8(o[q + 2] + (e[q + 2] - o[q + 2]) * p.blend);
		}
		return fxFromRaster(r);
	},
);

export const morphologyBlock = block(
	'fx.morphology',
	'Morfologia: erosão (min) ou dilatação (max) num raio quadrado.',
	{
		op: z.enum(['erode', 'dilate']).default('dilate'),
		radius: z.coerce.number().int().min(1).max(5).default(1),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h, data: src } = r;
		const rad = p.radius;
		const dilate = p.op === 'dilate';
		const out = new Uint8ClampedArray(src.length);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				let mr = dilate ? 0 : 255;
				let mg = dilate ? 0 : 255;
				let mb = dilate ? 0 : 255;
				for (let dy = -rad; dy <= rad; dy++) {
					let yy = y + dy;
					yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
					for (let dx = -rad; dx <= rad; dx++) {
						let xx = x + dx;
						xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
						const q = (yy * w + xx) * 4;
						if (dilate) {
							if (src[q] > mr) mr = src[q];
							if (src[q + 1] > mg) mg = src[q + 1];
							if (src[q + 2] > mb) mb = src[q + 2];
						} else {
							if (src[q] < mr) mr = src[q];
							if (src[q + 1] < mg) mg = src[q + 1];
							if (src[q + 2] < mb) mb = src[q + 2];
						}
					}
				}
				const o = (y * w + x) * 4;
				out[o] = mr;
				out[o + 1] = mg;
				out[o + 2] = mb;
				out[o + 3] = src[(y * w + x) * 4 + 3];
			}
		}
		return fxFromRaster({ data: out, width: w, height: h, channels: 4 });
	},
);

export const lensDistortionBlock = block(
	'fx.lensDistortion',
	'Distorção de lente: barril (>0) / almofada (<0) via remap radial.',
	{ amount: z.coerce.number().min(-0.5).max(0.5).default(0.2) },
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h, data: src } = r;
		if (p.amount === 0) return fxFromRaster(r);
		const out = new Uint8ClampedArray(src.length);
		const cx = (w - 1) / 2;
		const cy = (h - 1) / 2;
		const norm = Math.sqrt(cx * cx + cy * cy) || 1;
		const k = p.amount;
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				// Distância radial normalizada e fator de remap.
				const ndx = (x - cx) / norm;
				const ndy = (y - cy) / norm;
				const rr2 = ndx * ndx + ndy * ndy;
				const f = 1 + k * rr2;
				let sx = Math.round(cx + (x - cx) * f);
				let sy = Math.round(cy + (y - cy) * f);
				sx = sx < 0 ? 0 : sx >= w ? w - 1 : sx;
				sy = sy < 0 ? 0 : sy >= h ? h - 1 : sy;
				const sq = (sy * w + sx) * 4;
				const o = (y * w + x) * 4;
				out[o] = src[sq];
				out[o + 1] = src[sq + 1];
				out[o + 2] = src[sq + 2];
				out[o + 3] = src[sq + 3];
			}
		}
		return fxFromRaster({ data: out, width: w, height: h, channels: 4 });
	},
);

export const invertBlock = block(
	'fx.invert',
	'Inverte as cores (negativo), preservando o alpha.',
	{},
	(p) => fxSharp(p.image, (s) => s.negate({ alpha: false })),
);

/* ───────────────────────────── Mask ───────────────────────────── */

export const alphaThresholdBlock = block(
	'mask.alphaThreshold',
	'Limiar de alpha: binariza o canal alpha com transição suave (softness).',
	{
		threshold: z.coerce.number().min(0).max(1).default(0.5),
		softness: z.coerce.number().min(0).max(0.5).default(0.02),
		invert: bool(false),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const thr = p.threshold * 255;
		const soft = Math.max(0.0001, p.softness * 255);
		const lo = thr - soft;
		const hi = thr + soft;
		mapPixels(r, (rr, gg, bb, aa) => {
			// smoothstep(lo, hi, aa) → transição suave em vez de degrau.
			let t = (aa - lo) / (hi - lo);
			t = t < 0 ? 0 : t > 1 ? 1 : t;
			t = t * t * (3 - 2 * t);
			let na = t * 255;
			if (p.invert) na = 255 - na;
			return [rr, gg, bb, clamp8(na)];
		});
		return fxFromRaster(r);
	},
);

export const alphaFeatherBlock = block(
	'mask.alphaFeather',
	'Suaviza a borda do alpha (aprox.): desfoque box só no canal alpha.',
	{ radius: z.coerce.number().min(0).max(24).default(2) },
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h, data: d } = r;
		const rad = Math.round(p.radius);
		if (rad <= 0) return fxFromRaster(r);
		// Extrai alpha em campo Float e borra com média de janela (separável H/V).
		const a = new Float64Array(w * h);
		for (let i = 0, q = 3; i < a.length; i++, q += 4) a[i] = d[q];
		const tmp = new Float64Array(w * h);
		const span = rad * 2 + 1;
		// Passada horizontal.
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				let s = 0;
				for (let dx = -rad; dx <= rad; dx++) {
					let xx = x + dx;
					xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
					s += a[y * w + xx];
				}
				tmp[y * w + x] = s / span;
			}
		}
		// Passada vertical → de volta pro alpha.
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				let s = 0;
				for (let dy = -rad; dy <= rad; dy++) {
					let yy = y + dy;
					yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
					s += tmp[yy * w + x];
				}
				d[(y * w + x) * 4 + 3] = clamp8(s / span);
			}
		}
		return fxFromRaster(r);
	},
);

/** Todos os blocos de borda/desfoque/máscara, pra registro no index. */
export const edgeBlurBlocks: ToolBlock[] = [
	edgeSobelBlock,
	edgeOutlineBlock,
	edgeHighPassBlock,
	edgeDetectBlock,
	cannyBlock,
	blurBoxBlock,
	blurGaussianBlock,
	blurMotionBlock,
	blurRadialBlock,
	blurSurfaceBlock,
	unsharpMaskBlock,
	sharpenBlock,
	denoiseBlock,
	noiseBlock,
	filmGrainBlock,
	embossBlock,
	morphologyBlock,
	lensDistortionBlock,
	invertBlock,
	alphaThresholdBlock,
	alphaFeatherBlock,
];
