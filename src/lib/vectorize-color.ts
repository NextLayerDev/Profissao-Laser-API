import * as Potrace from 'potrace';
import sharp from 'sharp';
import { classifyImage } from './image-classify.js';
import {
	segmentForeground,
	SegmentationUnavailableError,
} from './segment-foreground.js';
import { borderStats, chromaKeyAlpha } from '../tool-blocks/lib/pixels.js';
import type { VectorizeParams } from '../types/vector.js';

// ─────────────────────────────────────────────────────────────────────
// Vetorização EM CORES: imagens coloridas (logos, ilustrações) não podem ser
// traçadas com um único limiar P&B — verde e amarelo têm brilho parecido e
// viram um borrão. Aqui quantizamos a imagem em K cores (k-means), geramos uma
// máscara por cor, traçamos cada uma com o Potrace e montamos um SVG colorido
// em camadas (maior área primeiro → detalhes por cima). Resultado fiel à arte.
//
// REMOÇÃO DE FUNDO: duas ferramentas, escolhidas pelo mesmo classificador
// foto/logo já usado pro prompt P&B (`image-classify.ts`) — testado nos dois
// sentidos, cada uma é ruim no caso da outra:
//   FOTO → segmentação real (`segment-foreground.ts`, RMBG-1.4/BRIA). Ótima em
//          objeto/produto fotografado; mas em arte flat confunde letras
//          brancas com "fundo" e devolve texto fantasma.
//   LOGO → chroma-key das bordas (`removeBackgroundIterative`). Ótimo em fundo
//          sólido/degradê de estúdio; a segmentação erra feio nesse caso.
// O chroma-key sempre roda por cima como limpeza final (barato, idempotente
// quando não há mais nada de fundo pra remover).
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

	// init k-means++: 1º centroide = COR MÉDIA da amostra (estável; antes usava o
	// 1º pixel, sensível a um pixel ruidoso → paletas instáveis run-a-run); demais
	// = o pixel mais distante dos já escolhidos (determinístico).
	const centroids: Centroid[] = [];
	let mr = 0;
	let mg = 0;
	let mb = 0;
	for (let i = 0; i < n; i++) {
		mr += samples[i * 3];
		mg += samples[i * 3 + 1];
		mb += samples[i * 3 + 2];
	}
	centroids.push({ r: mr / n, g: mg / n, b: mb / n });
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

/**
 * Funde centróides quase-iguais (distância² < minD2). O k-means costuma gastar
 * clusters em variações mínimas de anti-alias/JPEG → camadas sobrepostas quase
 * da mesma cor. Fundir devolve regiões chapadas e menos "fatias" na borda.
 */
function mergeNearCentroids(centroids: Centroid[], minD2: number): Centroid[] {
	const out: Centroid[] = [];
	for (const c of centroids) {
		const near = out.find((o) => dist2(c.r, c.g, c.b, o) < minD2);
		if (near) {
			near.r = (near.r + c.r) / 2;
			near.g = (near.g + c.g) / 2;
			near.b = (near.b + c.b) / 2;
		} else {
			out.push({ ...c });
		}
	}
	return out;
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
 * Remove o fundo em cima do raster (in place) rodando o chroma-key das
 * bordas em VÁRIAS passadas — cada rodada recalcula a cor de referência só a
 * partir do que ainda restou de borda opaca. Fundo de foto/estúdio quase
 * sempre tem uma vinheta/degradê leve (mais escuro num canto); uma única
 * passada com referência fixa só pega a região perto da mediana da borda e
 * deixa um resto da mesma "família" de cor sem remover (ex.: canto mais
 * escuro). A cada rodada a mediana persegue esse resto, sem precisar de uma
 * tolerância larga o bastante pra também comer o sujeito.
 *
 * TRAVA (crítica): se a 1ª passada já remover o fundo de verdade, o que
 * sobra encostado na borda pode ser o PRÓPRIO desenho (ex.: um elemento
 * full-bleed que toca a borda) — sem essa trava, a passada seguinte trataria
 * a cor dele como "o novo fundo" e comeria o elemento inteiro. Por isso só
 * deixa avançar pra próxima passada se a nova referência for parecida com a
 * anterior (mesma família de cor = perseguindo degradê); se a cor mudou
 * demais, provavelmente não é mais fundo — para ali.
 */
function removeBackgroundIterative(
	raster: Parameters<typeof borderStats>[0],
	tolerance: number,
	feather: number,
	maxPasses = 4,
): void {
	// Cap mais largo que a tolerância pixel-a-pixel: uma vinheta de foto real
	// pode variar bem mais que isso ponta-a-ponta (bordas: claro → escuro) sem
	// deixar de ser "o mesmo fundo"; já uma cor de primeiro plano de verdade
	// (ex.: uma barra colorida do próprio design) costuma saltar bem mais que
	// isso a partir do fundo.
	const driftCap = 0.35 * Math.sqrt(3) * 255;
	let prevRef: { br: number; bgC: number; bb: number } | null = null;
	for (let i = 0; i < maxPasses; i++) {
		const stats = borderStats(raster);
		if (stats.samples < 8) break;
		if (prevRef) {
			const dr = stats.br - prevRef.br;
			const dg = stats.bgC - prevRef.bgC;
			const db = stats.bb - prevRef.bb;
			if (Math.sqrt(dr * dr + dg * dg + db * db) > driftCap) break;
		}
		const marked = chromaKeyAlpha(
			raster,
			stats.br,
			stats.bgC,
			stats.bb,
			tolerance,
			feather,
		);
		if (marked === 0) break;
		prevRef = { br: stats.br, bgC: stats.bgC, bb: stats.bb };
	}
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

	// Só tenta segmentação real em FOTO (ver classificador no topo do arquivo).
	// Heurística apenas (sem IA de visão): mantém o botão "Laser + UV" grátis e
	// rápido — a heurística já bastou nos casos testados. Falha de carregar o
	// motor nativo (onnxruntime ausente) não pode derrubar a vetorização: cai
	// pro chroma-key, que já roda por cima de qualquer forma.
	let workingBuffer = buffer;
	const { kind } = await classifyImage(buffer, { allowAI: false });
	if (kind === 'photo') {
		try {
			workingBuffer = await segmentForeground(buffer);
		} catch (err) {
			if (!(err instanceof SegmentationUnavailableError)) throw err;
		}
	}

	let pipeline = sharp(workingBuffer)
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

	// `.ensureAlpha()` marca 100% opaco quando a entrada não tem alpha real (ex.:
	// foto/JPEG, ou PNG "achatado" que saiu de uma geração de IA) — sem isso, o
	// fundo vira só mais um cluster de cor e acaba desenhado como camada cheia
	// (o "fundo branco" que aparecia no vetor). Chroma-key das bordas ANTES do
	// k-means resolve — em várias passadas (ver `removeBackgroundIterative`)
	// pra perseguir vinheta/degradê leve sem precisar de tolerância larga o
	// bastante pra também comer o sujeito.
	const raster = {
		data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
		width,
		height,
		channels: 4 as const,
	};
	removeBackgroundIterative(raster, 0.16, 0.6, 3);

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
	let centroids = kmeans(opaque, k);
	// Funde só cores MUITO próximas (anti-alias/JPEG) — gentil p/ não borrar tons
	// próximos legítimos nem apagar detalhe fino.
	centroids = mergeNearCentroids(centroids, 12 * 12);

	// Rótulo de cada pixel (−1 = transparente).
	const labels = new Int16Array(npx).fill(-1);
	const counts = new Uint32Array(centroids.length);
	let opaqueTotal = 0;
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
		opaqueTotal++;
	}

	// Poda de clusters de área ínfima (halos de anti-alias / ruído): em vez de
	// virarem uma CAMADA de cor "fantasma" (fatia colorida na borda), seus pixels
	// são reatribuídos ao centróide remanescente mais próximo em cor — sem buracos
	// e sem slivers. Principal causa de o vetor colorido parecer "sujo".
	const minArea = Math.max(1, Math.floor(opaqueTotal * 0.0015)); // < 0,15% (preserva texto/detalhe)
	const keep = centroids.map((_, c) => counts[c] >= minArea);
	if (!keep.some(Boolean)) keep.fill(true); // nunca zera tudo
	if (keep.some((k) => !k)) {
		for (let i = 0; i < npx; i++) {
			const lab = labels[i];
			if (lab < 0 || keep[lab]) continue;
			const r = data[i * channels];
			const g = data[i * channels + 1];
			const b = data[i * channels + 2];
			let bi = -1;
			let bd = Number.POSITIVE_INFINITY;
			for (let c = 0; c < centroids.length; c++) {
				if (!keep[c]) continue;
				const d = dist2(r, g, b, centroids[c]);
				if (d < bd) {
					bd = d;
					bi = c;
				}
			}
			labels[i] = bi;
		}
		counts.fill(0);
		for (let i = 0; i < npx; i++) if (labels[i] >= 0) counts[labels[i]]++;
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
			// Limpeza morfológica: a mediana 3×3 mata "confete" de 1px e os halos de
			// anti-alias entre camadas ANTES de traçar — principal motivo de o vetor
			// colorido parecer sujo/ruidoso vs. um vetorizador comercial.
			.median(3)
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
