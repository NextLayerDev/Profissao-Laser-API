import sharp from 'sharp';
import { z } from 'zod';
import {
	clamp8,
	type FxOutput,
	fxFromRaster,
	fxSharp,
	loadRaster,
	luma,
	mapPixels,
} from '../lib/pixels.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos de ESTILIZAR (categoria `stylize`) — port do grupo "Stylize" do ImagR
 * (halftone / bloom / glitch / oil / pixelate / sketch / sepia / duotone /
 * cross-process / vignette / split-toning / comic / stipple / light-leak).
 * Faixas e defaults batem com o spec do handoff. Saída padrão de filtro:
 * `{ png, pngBase64 }`. Onde dá, usa `sharp` nativo; senão, loop sobre o raster.
 */

const img = z.instanceof(Buffer);

/** Parse de cor #rrggbb → [r,g,b] (com fallback). */
function hex(c: string | undefined, fallback: [number, number, number]) {
	const m = /^#?([0-9a-f]{6})$/i.exec((c ?? '').trim());
	if (!m) return fallback;
	const n = Number.parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number];
}

/** Açúcar: define um bloco de estilização com schema {image, ...P}. */
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
		category: 'stylize',
		description,
		paramsSchema: schema as z.ZodType<unknown>,
		run: (_ctx, params) =>
			run(params as z.infer<z.ZodObject<P & { image: typeof img }>>),
	} as ToolBlock;
}

/* ───────────────────────────── Halftone ───────────────────────────── */

export const halftoneBlock = block(
	'stylize.halftone',
	'Halftone: pontos tipo jornal — ponto por célula proporcional à luz. P&B.',
	{
		cell: z.coerce.number().min(2).max(120).default(14),
		angle: z.coerce.number().min(-3.14).max(3.14).default(0),
		contrast: z.coerce.number().min(0.25).max(4).default(1.5),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h, data: src } = r;
		const cell = Math.max(2, Math.round(p.cell));
		const out = new Uint8ClampedArray(w * h * 4);
		// Fundo branco; pontos pretos.
		for (let i = 0; i < w * h; i++) {
			const q = i * 4;
			out[q] = 255;
			out[q + 1] = 255;
			out[q + 2] = 255;
			out[q + 3] = 255;
		}
		const cosA = Math.cos(p.angle);
		const sinA = Math.sin(p.angle);
		const halfMax = (cell / 2) * Math.SQRT2; // raio máximo p/ cobrir a célula
		for (let cy = 0; cy < h; cy += cell) {
			for (let cx = 0; cx < w; cx += cell) {
				// Luminância média da célula.
				let sum = 0;
				let cnt = 0;
				const ex = Math.min(w, cx + cell);
				const ey = Math.min(h, cy + cell);
				for (let y = cy; y < ey; y++) {
					for (let x = cx; x < ex; x++) {
						const q = (y * w + x) * 4;
						sum += luma(src[q], src[q + 1], src[q + 2]);
						cnt++;
					}
				}
				const mean = cnt ? sum / cnt / 255 : 1;
				// Escuro → ponto grande. Contraste empurra pro extremo.
				let dark = 1 - mean;
				dark = Math.min(1, Math.max(0, (dark - 0.5) * p.contrast + 0.5));
				const radius = dark * halfMax;
				if (radius < 0.4) continue;
				// Centro da célula (gira o grid pelo ângulo, aprox. via rotação local).
				const ccx = cx + cell / 2;
				const ccy = cy + cell / 2;
				const r2 = radius * radius;
				const span = Math.ceil(radius) + 1;
				for (let dy = -span; dy <= span; dy++) {
					for (let dx = -span; dx <= span; dx++) {
						// Coordenada girada (mantém pontos circulares; ângulo gira o "screen").
						const rx = dx * cosA - dy * sinA;
						const ry = dx * sinA + dy * cosA;
						if (rx * rx + ry * ry > r2) continue;
						const px = Math.round(ccx + dx);
						const py = Math.round(ccy + dy);
						if (px < 0 || py < 0 || px >= w || py >= h) continue;
						const q = (py * w + px) * 4;
						out[q] = 0;
						out[q + 1] = 0;
						out[q + 2] = 0;
					}
				}
			}
		}
		return fxFromRaster({ data: out, width: w, height: h, channels: 4 });
	},
);

/* ───────────────────────────── Bloom ───────────────────────────── */

export const bloomBlock = block(
	'stylize.bloom',
	'Bloom: bright-pass + blur gaussiano somado de volta (screen) por intensity.',
	{
		threshold: z.coerce.number().min(0).max(1).default(0.75),
		radius: z.coerce.number().min(0.5).max(20).default(6),
		intensity: z.coerce.number().min(0).max(8).default(1.5),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h, data: src } = r;
		const cut = p.threshold * 255;
		// Bright-pass: mantém só o que passa do threshold (resto preto).
		const bright = new Uint8ClampedArray(w * h * 4);
		for (let q = 0; q < src.length; q += 4) {
			const l = luma(src[q], src[q + 1], src[q + 2]);
			if (l >= cut) {
				bright[q] = src[q];
				bright[q + 1] = src[q + 1];
				bright[q + 2] = src[q + 2];
			}
			bright[q + 3] = 255;
		}
		// Blur do bright-pass via sharp (sigma ~ radius).
		const brightPng = await sharp(
			Buffer.from(bright.buffer, bright.byteOffset, bright.byteLength),
			{ raw: { width: w, height: h, channels: 4 } },
		)
			.blur(Math.max(0.3, p.radius))
			.raw()
			.toBuffer();
		// Soma de volta (screen-ish: out = base + glow*intensity).
		for (let q = 0; q < src.length; q += 4) {
			src[q] = clamp8(src[q] + brightPng[q] * p.intensity);
			src[q + 1] = clamp8(src[q + 1] + brightPng[q + 1] * p.intensity);
			src[q + 2] = clamp8(src[q + 2] + brightPng[q + 2] * p.intensity);
		}
		return fxFromRaster(r);
	},
);

/* ───────────────────────────── Glitch ───────────────────────────── */

export const glitchBlock = block(
	'stylize.glitch',
	'Glitch: desloca canais R/B na horizontal + faixas deslocadas por intensity.',
	{
		intensity: z.coerce.number().min(0).max(1).default(0.5),
		rgbShift: z.coerce.number().min(0).max(20).default(5),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h, data: src } = r;
		const copy = src.slice();
		const sh = Math.round(p.rgbShift);
		const clampX = (x: number) => (x < 0 ? 0 : x >= w ? w - 1 : x);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const q = (y * w + x) * 4;
				// R deslocado pra direita, B pra esquerda; G fica.
				const qr = (y * w + clampX(x - sh)) * 4;
				const qb = (y * w + clampX(x + sh)) * 4;
				src[q] = copy[qr];
				src[q + 2] = copy[qb + 2];
			}
		}
		// Faixas horizontais deslocadas (quantidade/força conforme intensity).
		if (p.intensity > 0) {
			const bands = Math.round(2 + p.intensity * 12);
			const maxShift = Math.round(p.intensity * w * 0.12);
			let seed = 1337;
			const rnd = () => {
				// PRNG determinístico (pra preview estável).
				seed = (seed * 1664525 + 1013904223) >>> 0;
				return seed / 4294967296;
			};
			for (let b = 0; b < bands; b++) {
				const by = Math.floor(rnd() * h);
				const bh = 1 + Math.floor(rnd() * (h * 0.06));
				const shift = Math.round((rnd() * 2 - 1) * maxShift);
				for (let y = by; y < Math.min(h, by + bh); y++) {
					for (let x = 0; x < w; x++) {
						const q = (y * w + x) * 4;
						const sx = (y * w + clampX(x - shift)) * 4;
						src[q] = copy[sx];
						src[q + 1] = copy[sx + 1];
						src[q + 2] = copy[sx + 2];
					}
				}
			}
		}
		return fxFromRaster(r);
	},
);

/* ───────────────────────────── Oil Paint ───────────────────────────── */

export const oilPaintBlock = block(
	'stylize.oilPaint',
	'Pintura a óleo (aprox.): mediana (sharp) + leve posterização (8 níveis).',
	{ radius: z.coerce.number().min(1).max(8).default(4) },
	async (p) => {
		// aprox.: median amacia em "manchas", posterize reduz nuances de tom.
		const med = await fxSharp(p.image, (s) =>
			s.median(Math.max(1, Math.round(p.radius))),
		);
		const r = await loadRaster(med.png);
		const n = 8 - 1; // 8 níveis por canal
		mapPixels(r, (rr, gg, bb, aa) => [
			Math.round((Math.round((rr / 255) * n) / n) * 255),
			Math.round((Math.round((gg / 255) * n) / n) * 255),
			Math.round((Math.round((bb / 255) * n) / n) * 255),
			aa,
		]);
		return fxFromRaster(r);
	},
);

/* ───────────────────────────── Pixelate ───────────────────────────── */

export const pixelateBlock = block(
	'stylize.pixelate',
	'Pixelate: downscale + upscale nearest (blocos quadrados).',
	{ pixelSize: z.coerce.number().min(1).max(100).default(8) },
	async (p) => {
		const meta = await sharp(p.image).metadata();
		const w = meta.width ?? 1;
		const h = meta.height ?? 1;
		const sw = Math.max(1, Math.round(w / p.pixelSize));
		const sh = Math.max(1, Math.round(h / p.pixelSize));
		return fxSharp(p.image, (s) =>
			s
				.resize(sw, sh, { kernel: 'nearest' })
				.resize(w, h, { kernel: 'nearest' }),
		);
	},
);

/* ───────────────────────────── Sketch ───────────────────────────── */

export const sketchBlock = block(
	'stylize.sketch',
	'Esboço a lápis: gray dodge invert(blur(gray)) — out=gray*255/(255-blur).',
	{
		blurRadius: z.coerce.number().min(2).max(15).default(6),
		darkness: z.coerce.number().min(0.5).max(2).default(1),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h, data: src } = r;
		// Canal gray (1ch) e seu inverso borrado.
		const gray = new Uint8ClampedArray(w * h * 4);
		for (let i = 0; i < w * h; i++) {
			const q = i * 4;
			const g = clamp8(luma(src[q], src[q + 1], src[q + 2]));
			// guarda o inverso pra borrar.
			gray[q] = 255 - g;
			gray[q + 1] = 255 - g;
			gray[q + 2] = 255 - g;
			gray[q + 3] = 255;
		}
		const blurred = await sharp(
			Buffer.from(gray.buffer, gray.byteOffset, gray.byteLength),
			{ raw: { width: w, height: h, channels: 4 } },
		)
			.blur(Math.max(0.3, p.blurRadius))
			.raw()
			.toBuffer();
		// Color dodge: out = gray * 255 / (255 - blurInv).
		for (let i = 0; i < w * h; i++) {
			const q = i * 4;
			const g = luma(src[q], src[q + 1], src[q + 2]);
			const b = blurred[q]; // inverso borrado
			const denom = 255 - b;
			let v = denom <= 0 ? 255 : (g * 255) / denom;
			// darkness empurra o resultado pro escuro (>1) ou pro claro (<1).
			v = 255 - (255 - v) * p.darkness;
			const o = clamp8(v);
			src[q] = o;
			src[q + 1] = o;
			src[q + 2] = o;
		}
		return fxFromRaster(r);
	},
);

/* ───────────────────────────── Sepia ───────────────────────────── */

export const sepiaBlock = block(
	'stylize.sepia',
	'Sépia: recombinação clássica, blend com o original por intensity.',
	{ intensity: z.coerce.number().min(0).max(1).default(1) },
	async (p) => {
		const r = await loadRaster(p.image);
		const t = p.intensity;
		mapPixels(r, (rr, gg, bb, aa) => {
			const sr = 0.393 * rr + 0.769 * gg + 0.189 * bb;
			const sg = 0.349 * rr + 0.686 * gg + 0.168 * bb;
			const sb = 0.272 * rr + 0.534 * gg + 0.131 * bb;
			return [
				clamp8(rr + (sr - rr) * t),
				clamp8(gg + (sg - gg) * t),
				clamp8(bb + (sb - bb) * t),
				aa,
			];
		});
		return fxFromRaster(r);
	},
);

/* ───────────────────────────── Duotone ───────────────────────────── */

export const duotoneBlock = block(
	'stylize.duotone',
	'Duotone: mapa de gradiente entre 2 cores por luminância, blend por intensity.',
	{
		shadowColor: z.string().default('#1a1a2e'),
		highlightColor: z.string().default('#e94560'),
		intensity: z.coerce.number().min(0).max(1).default(1),
	},
	async (p) => {
		const lo = hex(p.shadowColor, [26, 26, 46]);
		const hi = hex(p.highlightColor, [233, 69, 96]);
		const t = p.intensity;
		const r = await loadRaster(p.image);
		mapPixels(r, (rr, gg, bb, aa) => {
			const k = luma(rr, gg, bb) / 255;
			const dr = lo[0] + (hi[0] - lo[0]) * k;
			const dg = lo[1] + (hi[1] - lo[1]) * k;
			const db = lo[2] + (hi[2] - lo[2]) * k;
			return [
				clamp8(rr + (dr - rr) * t),
				clamp8(gg + (dg - gg) * t),
				clamp8(bb + (db - bb) * t),
				aa,
			];
		});
		return fxFromRaster(r);
	},
);

/* ───────────────────────────── Cross Process ───────────────────────────── */

export const crossProcessBlock = block(
	'stylize.crossProcess',
	'Cross-process: curvas por canal (boost R/G, sombras B levantadas) por intensity.',
	{ intensity: z.coerce.number().min(0).max(1).default(1) },
	async (p) => {
		const t = p.intensity;
		const r = await loadRaster(p.image);
		// Curvas por canal (aplicadas com blend por intensity, sem LUT pra blendar fino).
		mapPixels(r, (rr, gg, bb, aa) => {
			const xr = rr / 255;
			const xg = gg / 255;
			const xb = bb / 255;
			// R/G: contraste em S (smoothstep). B: eleva sombras (raiz).
			const sr = 3 * xr * xr - 2 * xr * xr * xr;
			const sg = 3 * xg * xg - 2 * xg * xg * xg;
			const sb = xb ** 0.75 * 0.9 + 0.08; // levanta sombras do azul
			return [
				clamp8(rr + (sr * 255 - rr) * t),
				clamp8(gg + (sg * 255 - gg) * t),
				clamp8(bb + (sb * 255 - bb) * t),
				aa,
			];
		});
		return fxFromRaster(r);
	},
);

/* ───────────────────────────── Vignette ───────────────────────────── */

export const vignetteBlock = block(
	'stylize.vignette',
	'Vinheta: escurece (ou clareia se amount<0) as bordas radialmente.',
	{
		amount: z.coerce.number().min(-1).max(1).default(0.55),
		radius: z.coerce.number().min(0.05).max(1.2).default(0.65),
		feather: z.coerce.number().min(0.001).max(1).default(0.35),
		centerX: z.coerce.number().min(0).max(1).default(0.5),
		centerY: z.coerce.number().min(0).max(1).default(0.5),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h, data: src } = r;
		const cx = p.centerX * w;
		const cy = p.centerY * h;
		// Normaliza distância pela diagonal/2 (canto = ~1).
		const maxD = Math.hypot(w, h) / 2;
		const inner = p.radius;
		const outer = p.radius + Math.max(0.001, p.feather);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const d = Math.hypot(x - cx, y - cy) / maxD;
				// smoothstep(inner, outer, d) → 0 no centro, 1 nas bordas.
				let f = (d - inner) / (outer - inner);
				f = f < 0 ? 0 : f > 1 ? 1 : f;
				f = f * f * (3 - 2 * f);
				// amount>0 escurece (mul<1); amount<0 clareia (mul>1).
				const mul = 1 - p.amount * f;
				const q = (y * w + x) * 4;
				src[q] = clamp8(src[q] * mul);
				src[q + 1] = clamp8(src[q + 1] * mul);
				src[q + 2] = clamp8(src[q + 2] * mul);
			}
		}
		return fxFromRaster(r);
	},
);

/* ───────────────────────────── Split Toning ───────────────────────────── */

export const splitToningBlock = block(
	'stylize.splitToning',
	'Split-toning: tinge sombras e luzes com cores distintas conforme luminância.',
	{
		shadowColor: z.string().default('#26408b'),
		highlightColor: z.string().default('#f2d680'),
		balance: z.coerce.number().min(-1).max(1).default(0),
	},
	async (p) => {
		const sc = hex(p.shadowColor, [38, 64, 139]);
		const hc = hex(p.highlightColor, [242, 214, 128]);
		const r = await loadRaster(p.image);
		// balance desloca o ponto de corte sombra↔luz.
		const pivot = 0.5 + p.balance * 0.5;
		mapPixels(r, (rr, gg, bb, aa) => {
			const k = luma(rr, gg, bb) / 255;
			// Quantidade de tinta cresce longe do meio (sombra escura / luz clara),
			// o pivot (balance) desloca o ponto de troca sombra↔luz.
			const shadeAmt = (1 - k) * (1 - Math.min(1, k / Math.max(0.001, pivot)));
			const lightAmt = k * Math.min(1, k / Math.max(0.001, pivot));
			const tr = sc[0] * shadeAmt + hc[0] * lightAmt;
			const tg = sc[1] * shadeAmt + hc[1] * lightAmt;
			const tb = sc[2] * shadeAmt + hc[2] * lightAmt;
			const amt = shadeAmt + lightAmt;
			// Blend leve por cima do pixel original.
			return [
				clamp8(rr + (tr - rr) * amt * 0.6),
				clamp8(gg + (tg - gg) * amt * 0.6),
				clamp8(bb + (tb - bb) * amt * 0.6),
				aa,
			];
		});
		return fxFromRaster(r);
	},
);

/* ───────────────────────────── Comic ───────────────────────────── */

export const comicBlock = block(
	'stylize.comic',
	'HQ: posteriza + sobrepõe contornos pretos (edge laplaciano).',
	{ levels: z.coerce.number().int().min(2).max(6).default(4) },
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h, data: src } = r;
		// Gray pra detectar bordas (laplaciano).
		const gray = new Float64Array(w * h);
		for (let i = 0, q = 0; i < w * h; i++, q += 4)
			gray[i] = luma(src[q], src[q + 1], src[q + 2]);
		// Posteriza in-place.
		const n = p.levels - 1;
		mapPixels(r, (rr, gg, bb, aa) => [
			Math.round((Math.round((rr / 255) * n) / n) * 255),
			Math.round((Math.round((gg / 255) * n) / n) * 255),
			Math.round((Math.round((bb / 255) * n) / n) * 255),
			aa,
		]);
		// Laplaciano 3×3: borda forte → pinta de preto por cima.
		const clampX = (x: number) => (x < 0 ? 0 : x >= w ? w - 1 : x);
		const clampY = (y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y);
		const EDGE = 28; // limiar de borda
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const c = gray[y * w + x];
				const lap =
					gray[clampY(y - 1) * w + x] +
					gray[clampY(y + 1) * w + x] +
					gray[y * w + clampX(x - 1)] +
					gray[y * w + clampX(x + 1)] -
					4 * c;
				if (Math.abs(lap) > EDGE) {
					const q = (y * w + x) * 4;
					src[q] = 0;
					src[q + 1] = 0;
					src[q + 2] = 0;
				}
			}
		}
		return fxFromRaster(r);
	},
);

/* ───────────────────────────── Stipple ───────────────────────────── */

export const stippleBlock = block(
	'stylize.stipple',
	'Pontilhismo P&B: pontos pretos com probabilidade ~ (1-luma) (hash por pixel).',
	{ density: z.coerce.number().min(0).max(1).default(0.5) },
	async (p) => {
		const r = await loadRaster(p.image);
		const { width: w, height: h, data: src } = r;
		const out = new Uint8ClampedArray(w * h * 4);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const q = (y * w + x) * 4;
				const dark = 1 - luma(src[q], src[q + 1], src[q + 2]) / 255;
				const prob = dark * (0.3 + p.density * 1.4);
				// Hash determinístico por pixel → ruído estável (preview reprodutível).
				let hsh = (x * 73856093) ^ (y * 19349663);
				hsh = (hsh ^ (hsh >>> 13)) >>> 0;
				const rnd = (hsh % 1000) / 1000;
				const v = rnd < prob ? 0 : 255;
				out[q] = v;
				out[q + 1] = v;
				out[q + 2] = v;
				out[q + 3] = 255;
			}
		}
		return fxFromRaster({ data: out, width: w, height: h, channels: 4 });
	},
);

/* ───────────────────────────── Light Leak ───────────────────────────── */

export const lightLeakBlock = block(
	'stylize.lightLeak',
	'Light leak: gradiente de luz colorido num canto, composto em screen.',
	{
		intensity: z.coerce.number().min(0).max(1).default(0.5),
		color: z.string().default('#ff7b00'),
	},
	async (p) => {
		const col = hex(p.color, [255, 123, 0]);
		const r = await loadRaster(p.image);
		const { width: w, height: h, data: src } = r;
		// Vazamento ancorado no canto superior-direito.
		const lx = w;
		const ly = 0;
		const maxD = Math.hypot(w, h);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const d = Math.hypot(x - lx, y - ly) / maxD;
				// Mais forte perto do canto, esmaece com a distância.
				const g = Math.max(0, 1 - d * 1.6) * p.intensity;
				if (g <= 0) continue;
				const lr = col[0] * g;
				const lg = col[1] * g;
				const lb = col[2] * g;
				const q = (y * w + x) * 4;
				// Screen: out = 255 - (255-base)*(255-leak)/255.
				src[q] = clamp8(255 - ((255 - src[q]) * (255 - lr)) / 255);
				src[q + 1] = clamp8(255 - ((255 - src[q + 1]) * (255 - lg)) / 255);
				src[q + 2] = clamp8(255 - ((255 - src[q + 2]) * (255 - lb)) / 255);
			}
		}
		return fxFromRaster(r);
	},
);

/** Todos os blocos de estilização, pra registro no index. */
export const stylizeBlocks: ToolBlock[] = [
	halftoneBlock,
	bloomBlock,
	glitchBlock,
	oilPaintBlock,
	pixelateBlock,
	sketchBlock,
	sepiaBlock,
	duotoneBlock,
	crossProcessBlock,
	vignetteBlock,
	splitToningBlock,
	comicBlock,
	stippleBlock,
	lightLeakBlock,
];
