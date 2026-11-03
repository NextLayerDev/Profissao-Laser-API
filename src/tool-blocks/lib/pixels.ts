import sharp from 'sharp';
import { ToolEngineError } from '../../lib/tool-errors.js';

/**
 * Helpers compartilhados pela biblioteca de blocos de imagem (port do catálogo
 * ImagR). Os shaders WebGL do ImagR são per-pixel/convolução; aqui rodam em
 * `sharp` (nativo, quando dá) ou num loop sobre o raster RGBA. Cada bloco de
 * filtro devolve sempre `{ png, pngBase64 }` (mesmo contrato do
 * `laser.photoengrave`/`ai.generate_image`) — assim o front pré-visualiza e
 * baixa de forma uniforme, sem precisar subir pro storage (instantâneo, sem
 * custo de CDN).
 */

/** Raster RGBA decodificado em memória. `data` tem width*height*4 bytes. */
export interface Raster {
	data: Uint8ClampedArray;
	width: number;
	height: number;
	/** Sempre 4 (RGBA) — uniformiza o loop de pixels. */
	channels: 4;
}

/** Saída padrão de um bloco de filtro de imagem. */
export interface FxOutput {
	png: Buffer;
	pngBase64: string;
}

/**
 * Teto de pixels pra processamento em JS (60 MP). O `image.input` já barra
 * entradas acima de 200 MP, mas os loops/convoluções deste módulo alocam
 * Float/Uint proporcionais a width×height — um teto mais apertado evita OOM.
 */
const MAX_FX_PIXELS = 60 * 1_000_000;

/** Decodifica um buffer em raster RGBA cru (flatten do alpha NÃO é feito aqui). */
export async function loadRaster(buf: Buffer): Promise<Raster> {
	const meta = await sharp(buf).metadata();
	const w = meta.width ?? 0;
	const h = meta.height ?? 0;
	if (w * h > MAX_FX_PIXELS) {
		throw new ToolEngineError(
			400,
			`Imagem grande demais pra este filtro: ${w}x${h}px (teto ${
				MAX_FX_PIXELS / 1_000_000
			} MP). Reduza a imagem.`,
		);
	}
	const { data, info } = await sharp(buf)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return {
		data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
		width: info.width,
		height: info.height,
		channels: 4,
	};
}

/** Re-encoda um raster RGBA em PNG. */
export async function rasterToPng(r: Raster): Promise<Buffer> {
	return sharp(
		Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength),
		{
			raw: { width: r.width, height: r.height, channels: 4 },
		},
	)
		.png()
		.toBuffer();
}

const b64 = (png: Buffer): string =>
	`data:image/png;base64,${png.toString('base64')}`;

/** Saída padrão a partir de um raster RGBA. */
export async function fxFromRaster(r: Raster): Promise<FxOutput> {
	const png = await rasterToPng(r);
	return { png, pngBase64: b64(png) };
}

/** Saída padrão a partir de um Buffer PNG já pronto (ex.: cadeia sharp nativa). */
export function fxFromPng(png: Buffer): FxOutput {
	return { png, pngBase64: b64(png) };
}

/**
 * Aplica uma cadeia `sharp` nativa (blur, sharpen, modulate, linear, recomb,
 * clahe, median, threshold, negate, normalize, rotate, …) e devolve `{png,…}`.
 */
export async function fxSharp(
	buf: Buffer,
	build: (s: sharp.Sharp) => sharp.Sharp,
): Promise<FxOutput> {
	const png = await build(sharp(buf)).png().toBuffer();
	return fxFromPng(png);
}

/** Clampa pra [0,255] inteiro. */
export const clamp8 = (v: number): number =>
	v < 0 ? 0 : v > 255 ? 255 : Math.round(v);

/** Luminância Rec.709 de um RGB (0..255). */
export const luma = (rr: number, gg: number, bb: number): number =>
	0.2126 * rr + 0.7152 * gg + 0.0722 * bb;

/** Extrai 1 canal grayscale (Rec.709) do raster RGBA. */
export function toGray1(r: Raster): Buffer {
	const n = r.width * r.height;
	const out = Buffer.allocUnsafe(n);
	const d = r.data;
	for (let i = 0, p = 0; i < n; i++, p += 4) {
		out[i] = Math.round(luma(d[p], d[p + 1], d[p + 2]));
	}
	return out;
}

/** Monta um raster RGBA a partir de 1 canal grayscale (alpha = 255). */
export function gray1ToRaster(
	gray: Buffer | Uint8Array,
	width: number,
	height: number,
): Raster {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		const v = gray[i];
		const p = i * 4;
		data[p] = v;
		data[p + 1] = v;
		data[p + 2] = v;
		data[p + 3] = 255;
	}
	return { data, width, height, channels: 4 };
}

/**
 * Aplica uma LUT (256 entradas) aos canais R,G,B (alpha intacto). Use a mesma
 * LUT pros 3 (curva tonal) ou passe LUTs separadas por canal.
 */
export function applyLut(
	r: Raster,
	lutR: Uint8Array | number[],
	lutG: Uint8Array | number[] = lutR,
	lutB: Uint8Array | number[] = lutR,
): void {
	const d = r.data;
	for (let p = 0; p < d.length; p += 4) {
		d[p] = lutR[d[p]];
		d[p + 1] = lutG[d[p + 1]];
		d[p + 2] = lutB[d[p + 2]];
	}
}

/** Constrói uma LUT 0..255 a partir de uma função (clampada). */
export function buildLut(fn: (v: number) => number): Uint8Array {
	const lut = new Uint8Array(256);
	for (let i = 0; i < 256; i++) lut[i] = clamp8(fn(i));
	return lut;
}

/** Mapeia cada pixel (RGBA → RGBA). Retorna [r,g,b] ou [r,g,b,a]. */
export function mapPixels(
	r: Raster,
	fn: (
		rr: number,
		gg: number,
		bb: number,
		aa: number,
	) => [number, number, number] | [number, number, number, number],
): void {
	const d = r.data;
	for (let p = 0; p < d.length; p += 4) {
		const o = fn(d[p], d[p + 1], d[p + 2], d[p + 3]);
		d[p] = o[0];
		d[p + 1] = o[1];
		d[p + 2] = o[2];
		if (o.length === 4) d[p + 3] = o[3] as number;
	}
}

/** Estatísticas das bordas: cor mediana do fundo + desvio (uniformidade). */
export function borderStats(r: Raster) {
	const { data, width, height } = r;
	const rs: number[] = [];
	const gs: number[] = [];
	const bs: number[] = [];
	const push = (idx: number) => {
		const o = idx * 4;
		if (data[o + 3] < 8) return; // ignora borda já transparente
		rs.push(data[o]);
		gs.push(data[o + 1]);
		bs.push(data[o + 2]);
	};
	for (let x = 0; x < width; x++) {
		push(x);
		push((height - 1) * width + x);
	}
	for (let y = 1; y < height - 1; y++) {
		push(y * width);
		push(y * width + width - 1);
	}
	const med = (a: number[]) => {
		a.sort((x, y) => x - y);
		return a[a.length >> 1];
	};
	const std = (a: number[], m: number) => {
		if (!a.length) return 0;
		let s = 0;
		for (const v of a) s += (v - m) * (v - m);
		return Math.sqrt(s / a.length);
	};
	const br = med([...rs]);
	const bgC = med([...gs]);
	const bb = med([...bs]);
	// "uniformidade" = maior desvio entre canais (fundo bagunçado → alto)
	const dev = Math.max(std(rs, br), std(gs, bgC), std(bs, bb));
	return { br, bgC, bb, dev, samples: rs.length };
}

/**
 * Chroma-key IN PLACE: flood-fill 4-conexo das bordas dentro de uma tolerância de
 * cor ao fundo (br,bgC,bb), tornando transparente só o fundo CONECTADO à borda —
 * áreas da mesma cor DENTRO do sujeito ficam intactas. Feather na borda. Devolve
 * o nº de pixels marcados como fundo (0 se não aplicou).
 */
export function chromaKeyAlpha(
	r: Raster,
	br: number,
	bgC: number,
	bb: number,
	tolerance: number,
	feather: number,
): number {
	const { data, width, height } = r;
	const n = width * height;
	const MAXD = Math.sqrt(3) * 255;
	const hard = tolerance * MAXD;
	const soft = Math.min(MAXD, hard * (1 + feather));
	const dist = (idx: number) => {
		const o = idx * 4;
		const dr = data[o] - br;
		const dg = data[o + 1] - bgC;
		const db = data[o + 2] - bb;
		return Math.sqrt(dr * dr + dg * dg + db * db);
	};
	const isBg = new Uint8Array(n);
	const stack = new Int32Array(n);
	let sp = 0;
	let marked = 0;
	const seed = (idx: number) => {
		if (isBg[idx] === 0 && dist(idx) <= hard) {
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
	if (marked < 32 || marked > n * 0.985) return 0; // vazou tudo / nada → não aplica
	for (let idx = 0; idx < n; idx++) if (isBg[idx]) data[idx * 4 + 3] = 0;
	if (soft > hard) {
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const idx = y * width + x;
				if (isBg[idx]) continue;
				const touches =
					(x > 0 && isBg[idx - 1]) ||
					(x < width - 1 && isBg[idx + 1]) ||
					(y > 0 && isBg[idx - width]) ||
					(y < height - 1 && isBg[idx + width]);
				if (!touches) continue;
				const d = dist(idx);
				if (d < soft) {
					const a = (d - hard) / (soft - hard);
					data[idx * 4 + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
				}
			}
		}
	}
	return marked;
}

/**
 * Convolução genérica num kernel (kw×kh) sobre os canais RGB (alpha intacto),
 * borda clamped (replica). Devolve um NOVO raster. `divisor`/`bias` padrão do
 * kernel. Usada por edge/emboss/sharpen custom.
 */
export function convolve(
	r: Raster,
	kernel: number[],
	kw: number,
	kh: number,
	divisor = 1,
	bias = 0,
): Raster {
	const { width: w, height: h, data: src } = r;
	const out = new Uint8ClampedArray(src.length);
	const ox = kw >> 1;
	const oy = kh >> 1;
	const inv = divisor === 0 ? 1 : 1 / divisor;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let sr = 0;
			let sg = 0;
			let sb = 0;
			let k = 0;
			for (let ky = 0; ky < kh; ky++) {
				let yy = y + ky - oy;
				yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
				for (let kx = 0; kx < kw; kx++) {
					let xx = x + kx - ox;
					xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
					const wgt = kernel[k++];
					const p = (yy * w + xx) * 4;
					sr += src[p] * wgt;
					sg += src[p + 1] * wgt;
					sb += src[p + 2] * wgt;
				}
			}
			const p = (y * w + x) * 4;
			out[p] = sr * inv + bias;
			out[p + 1] = sg * inv + bias;
			out[p + 2] = sb * inv + bias;
			out[p + 3] = src[p + 3];
		}
	}
	return { data: out, width: w, height: h, channels: 4 };
}
