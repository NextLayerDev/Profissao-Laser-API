import * as Potrace from 'potrace';
import sharp from 'sharp';
import type { VectorizeParams } from '../types/vector.js';

// ─────────────────────────────────────────────────────────────────────
// Vetorização EM CORES: imagens coloridas (logos, ilustrações) não podem ser
// traçadas com um único limiar P&B — verde e amarelo têm brilho parecido e
// viram um borrão. Aqui quantizamos a imagem em K cores (k-means), geramos uma
// máscara por cor, traçamos cada uma com o Potrace e montamos um SVG colorido
// em camadas (maior área primeiro → detalhes por cima). Resultado fiel à arte.
// ─────────────────────────────────────────────────────────────────────

interface Centroid {
	r: number;
	g: number;
	b: number;
}

function toHex(c: Centroid): string {
	const h = (n: number) =>
		Math.max(0, Math.min(255, Math.round(n)))
			.toString(16)
			.padStart(2, '0');
	return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function dist2(r: number, g: number, b: number, c: Centroid): number {
	const dr = r - c.r;
	const dg = g - c.g;
	const db = b - c.b;
	return dr * dr + dg * dg + db * db;
}

/** k-means++ init + iterações sobre uma amostra. Determinístico (sem random). */
function kmeans(samples: number[], k: number): Centroid[] {
	const n = samples.length / 3;
	if (n === 0) return [{ r: 0, g: 0, b: 0 }];
	const realK = Math.min(k, n);

	// init k-means++: 1º centroide = amostra média-distante do meio; demais = o
	// pixel mais distante dos já escolhidos (determinístico).
	const centroids: Centroid[] = [];
	centroids.push({
		r: samples[0],
		g: samples[1],
		b: samples[2],
	});
	while (centroids.length < realK) {
		let best = -1;
		let bestD = -1;
		for (let i = 0; i < n; i++) {
			const r = samples[i * 3];
			const g = samples[i * 3 + 1];
			const b = samples[i * 3 + 2];
			let dmin = Number.POSITIVE_INFINITY;
			for (const c of centroids) {
				const d = dist2(r, g, b, c);
				if (d < dmin) dmin = d;
			}
			if (dmin > bestD) {
				bestD = dmin;
				best = i;
			}
		}
		if (best < 0) break;
		centroids.push({
			r: samples[best * 3],
			g: samples[best * 3 + 1],
			b: samples[best * 3 + 2],
		});
	}

	// Lloyd: ~10 iterações.
	for (let iter = 0; iter < 10; iter++) {
		const sumR = new Float64Array(centroids.length);
		const sumG = new Float64Array(centroids.length);
		const sumB = new Float64Array(centroids.length);
		const cnt = new Uint32Array(centroids.length);
		for (let i = 0; i < n; i++) {
			const r = samples[i * 3];
			const g = samples[i * 3 + 1];
			const b = samples[i * 3 + 2];
			let bi = 0;
			let bd = Number.POSITIVE_INFINITY;
			for (let c = 0; c < centroids.length; c++) {
				const d = dist2(r, g, b, centroids[c]);
				if (d < bd) {
					bd = d;
					bi = c;
				}
			}
			sumR[bi] += r;
			sumG[bi] += g;
			sumB[bi] += b;
			cnt[bi]++;
		}
		for (let c = 0; c < centroids.length; c++) {
			if (cnt[c] === 0) continue;
			centroids[c] = {
				r: sumR[c] / cnt[c],
				g: sumG[c] / cnt[c],
				b: sumB[c] / cnt[c],
			};
		}
	}
	return centroids;
}

function extractPathData(svg: string): string {
	const re = /<path[^>]*\sd="([^"]+)"/g;
	const parts: string[] = [];
	let m = re.exec(svg);
	while (m !== null) {
		parts.push(m[1]);
		m = re.exec(svg);
	}
	return parts.join(' ');
}

/** Traça uma máscara 1-bit (forma = 0/preto) e devolve o `d` combinado. */
function traceMask(maskPng: Buffer, params: VectorizeParams): Promise<string> {
	return new Promise((resolve, reject) => {
		Potrace.trace(
			maskPng,
			{
				turdSize: params.turdSize,
				optTolerance: params.optTolerance,
				alphaMax: params.alphaMax,
				optCurve: true,
				blackOnWhite: true,
				threshold: 128,
				background: 'transparent',
			} as Potrace.PotraceOptions,
			(err: Error | null, svg: string) => {
				if (err) return reject(err);
				resolve(svg ? extractPathData(svg) : '');
			},
		);
	});
}

export interface ColorVectorizeOptions {
	/** Dimensão de trabalho (preview usa menor p/ rapidez). */
	maxDim?: number;
}

/**
 * Vetoriza preservando as cores. `params.maxColors` controla quantas cores a
 * paleta terá (clampado pelo schema). Devolve o SVG colorido completo.
 */
export async function vectorizeColorImage(
	buffer: Buffer,
	params: VectorizeParams,
	opts: ColorVectorizeOptions = {},
): Promise<string> {
	const maxDim = opts.maxDim ?? 900;

	let pipeline = sharp(buffer)
		.resize({ width: maxDim, height: maxDim, fit: 'inside' })
		.ensureAlpha();
	// Desfoque leve só se pedido (reduz ruído de JPEG antes de quantizar).
	if (params.blur !== null) pipeline = pipeline.blur(params.blur);

	const { data, info } = await pipeline
		.raw()
		.toBuffer({ resolveWithObject: true });
	const { width, height } = info;
	const channels = info.channels; // 4 (ensureAlpha)
	const npx = width * height;

	// Amostra de pixels opacos p/ o k-means (cap ~20k).
	const opaque: number[] = [];
	const step = Math.max(1, Math.floor(npx / 20000));
	for (let i = 0; i < npx; i += step) {
		const a = data[i * channels + 3];
		if (a < 128) continue;
		opaque.push(
			data[i * channels],
			data[i * channels + 1],
			data[i * channels + 2],
		);
	}
	const k = Math.max(2, Math.min(params.maxColors ?? 8, 16));
	const centroids = kmeans(opaque, k);

	// Rótulo de cada pixel (−1 = transparente).
	const labels = new Int16Array(npx).fill(-1);
	const counts = new Uint32Array(centroids.length);
	for (let i = 0; i < npx; i++) {
		const a = data[i * channels + 3];
		if (a < 128) continue;
		const r = data[i * channels];
		const g = data[i * channels + 1];
		const b = data[i * channels + 2];
		let bi = 0;
		let bd = Number.POSITIVE_INFINITY;
		for (let c = 0; c < centroids.length; c++) {
			const d = dist2(r, g, b, centroids[c]);
			if (d < bd) {
				bd = d;
				bi = c;
			}
		}
		labels[i] = bi;
		counts[bi]++;
	}

	// Camadas: maior área primeiro (fundo), detalhes por cima.
	const order = [...centroids.keys()]
		.filter((c) => counts[c] > 0)
		.sort((a, b) => counts[b] - counts[a]);

	const layers: string[] = [];
	for (const c of order) {
		const mask = Buffer.alloc(npx, 255); // branco = fundo
		for (let i = 0; i < npx; i++) if (labels[i] === c) mask[i] = 0; // preto = forma
		const maskPng = await sharp(mask, {
			raw: { width, height, channels: 1 },
		})
			.png()
			.toBuffer();
		const d = await traceMask(maskPng, params);
		if (d.trim()) {
			layers.push(`<path fill="${toHex(centroids[c])}" d="${d}"/>`);
		}
	}

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
		`viewBox="0 0 ${width} ${height}">${layers.join('')}</svg>`
	);
}
