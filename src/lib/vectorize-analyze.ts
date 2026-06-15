import sharp from 'sharp';
import type { VectorizeParams } from '../types/vector.js';

// ─────────────────────────────────────────────────────────────────────
// Auto-vetorização: ROUTER (classifica o tipo de imagem) → IMAGE ANALYTICS
// (mede a imagem e deriva os parâmetros ideais do motor). Puro CV via sharp,
// determinístico: sem LLM, sem storage, sem cobrança. Devolve um perfil com
// `recommendedParams` que o front aplica sozinho no modo "Automático".
// ─────────────────────────────────────────────────────────────────────

export type VectorClass =
	| 'text'
	| 'line_art'
	| 'logo'
	| 'color_flat'
	| 'grayscale_tonal'
	| 'photo';

export interface ImageMetrics {
	width: number;
	height: number;
	hasAlpha: boolean;
	/** Cores distintas (quantizadas 4 bits/canal; máx 4096). */
	colorCount: number;
	/** Entropia do canal de cinza (0–8). */
	grayEntropy: number;
	/** Limiar ótimo de Otsu (0–255). */
	otsuThreshold: number;
	/** Fração de pixels quase-preto/quase-branco (proxy de bimodalidade, 0–1). */
	bimodality: number;
	/** Fração estimada de "tinta"/assunto após o limiar (0–1). */
	foregroundRatio: number;
	/** Fundo predominante escuro → precisa inverter. */
	darkBackground: boolean;
	/** Densidade de bordas (0–1). */
	edgeDensity: number;
	/** Estimativa de ruído / textura (0–1). */
	noise: number;
}

export interface ImageProfile {
	class: VectorClass;
	label: string;
	reason: string;
	confidence: number;
	metrics: ImageMetrics;
	recommendedParams: Partial<VectorizeParams>;
	/** Foto: vetorização rende mal → sugerir a Gravação 1-Clique. */
	recommendTool?: 'engraving';
}

const ANALYZE_DIM = 512; // resolução de trabalho p/ análise rápida

function clamp(v: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, v));
}

// ─── Primitivas de análise ───────────────────────────────────────────

function histogram(gray: Buffer | Uint8Array): Uint32Array {
	const h = new Uint32Array(256);
	for (let i = 0; i < gray.length; i++) h[gray[i]]++;
	return h;
}

/** Limiar de Otsu: maximiza a variância entre as duas classes. */
function otsu(hist: Uint32Array, total: number): number {
	let sum = 0;
	for (let t = 0; t < 256; t++) sum += t * hist[t];
	let sumB = 0;
	let wB = 0;
	let maxVar = -1;
	let threshold = 128;
	for (let t = 0; t < 256; t++) {
		wB += hist[t];
		if (wB === 0) continue;
		const wF = total - wB;
		if (wF === 0) break;
		sumB += t * hist[t];
		const mB = sumB / wB;
		const mF = (sum - sumB) / wF;
		const between = wB * wF * (mB - mF) * (mB - mF);
		if (between > maxVar) {
			maxVar = between;
			threshold = t;
		}
	}
	return threshold;
}

function entropyOf(hist: Uint32Array, total: number): number {
	let e = 0;
	for (let i = 0; i < 256; i++) {
		if (hist[i] === 0) continue;
		const p = hist[i] / total;
		e -= p * Math.log2(p);
	}
	return e;
}

/** Cores distintas, quantizando 4 bits por canal (máx 4096 buckets). */
function countColors(rgb: Buffer | Uint8Array, channels: number): number {
	const seen = new Set<number>();
	for (let i = 0; i + channels - 1 < rgb.length; i += channels) {
		const r = rgb[i] >> 4;
		const g = rgb[i + 1] >> 4;
		const b = rgb[i + 2] >> 4;
		seen.add((r << 8) | (g << 4) | b);
		if (seen.size >= 4096) break;
	}
	return seen.size;
}

/** Laplaciano: densidade de bordas + estimativa de ruído. */
function edgeMetrics(
	gray: Buffer | Uint8Array,
	w: number,
	h: number,
): { edgeDensity: number; noise: number } {
	if (w < 3 || h < 3) return { edgeDensity: 0, noise: 0 };
	let edges = 0;
	let sumAbs = 0;
	let n = 0;
	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			const i = y * w + x;
			const lap =
				4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
			const a = Math.abs(lap);
			sumAbs += a;
			n++;
			if (a > 24) edges++;
		}
	}
	return {
		edgeDensity: n ? edges / n : 0,
		noise: n ? clamp(sumAbs / n / 64, 0, 1) : 0,
	};
}

// ─── Router + derivação de parâmetros ────────────────────────────────

const LABELS: Record<VectorClass, string> = {
	text: 'Texto / Tipografia',
	line_art: 'Arte de linha',
	logo: 'Logo / Vetor chapado',
	color_flat: 'Ilustração com cores chapadas',
	grayscale_tonal: 'Imagem em tons de cinza',
	photo: 'Foto / Imagem complexa',
};

/** Decide a classe + os parâmetros do motor a partir das métricas. */
function classify(m: ImageMetrics): ImageProfile {
	const base: Partial<VectorizeParams> = {
		threshold: m.otsuThreshold,
		invert: m.darkBackground,
	};
	// turdSize cresce com o ruído (suprime manchas); blur só se bem ruidoso.
	const noisyTurd = (n: number) => Math.round(n + m.noise * 8);
	const maybeBlur = m.noise > 0.18 ? 0.6 : null;

	let cls: VectorClass;
	let reason: string;
	let confidence: number;
	let params: Partial<VectorizeParams>;
	let recommendTool: 'engraving' | undefined;

	if (m.colorCount > 3500 && m.grayEntropy > 6.7 && m.noise > 0.12) {
		cls = 'photo';
		reason = 'Muitas cores, tom contínuo e textura — típico de foto.';
		confidence = 0.85;
		recommendTool = 'engraving';
		params = {
			...base,
			mode: 'posterize',
			posterizeLevels: 6,
			turdSize: noisyTurd(6),
			optTolerance: 0.2,
			blur: maybeBlur,
		};
	} else if (
		m.bimodality > 0.85 &&
		m.foregroundRatio < 0.22 &&
		m.edgeDensity > 0.03 &&
		m.colorCount < 600
	) {
		cls = 'text';
		reason = 'Alto contraste, traços finos e pouca tinta — texto.';
		confidence = 0.9;
		params = {
			...base,
			mode: 'trace',
			turdSize: 2,
			alphaMax: 1.3,
			optTolerance: 0.2,
			sharpen: true,
		};
	} else if (m.colorCount <= 600 && m.bimodality > 0.6) {
		// Linha fina (line art) vs forma chapada (logo).
		const isLogo = m.foregroundRatio >= 0.15 && (m.hasAlpha || m.noise < 0.08);
		cls = isLogo ? 'logo' : 'line_art';
		reason = isLogo
			? 'Poucas cores e formas chapadas com bordas nítidas — logo.'
			: 'Poucas cores e traços finos de alto contraste — arte de linha.';
		confidence = 0.82;
		params = {
			...base,
			mode: 'trace',
			turdSize: noisyTurd(isLogo ? 2 : 3),
			alphaMax: isLogo ? 1.1 : 1.2,
			optTolerance: isLogo ? 0.3 : 0.2,
			sharpen: isLogo,
			blur: maybeBlur,
		};
	} else if (m.colorCount <= 64) {
		cls = 'color_flat';
		reason = 'Poucas cores chapadas — ilustração vetorizável por camadas.';
		confidence = 0.75;
		params = {
			...base,
			mode: 'posterize',
			posterizeLevels: clamp(Math.round(Math.log2(m.colorCount + 2)), 3, 6),
			posterizeFillStrategy: 'dominant',
			turdSize: noisyTurd(4),
			optTolerance: 0.2,
		};
	} else if (m.grayEntropy > 5.8) {
		cls = 'grayscale_tonal';
		reason = 'Tom contínuo com poucas cores — melhor por níveis (posterize).';
		confidence = 0.7;
		params = {
			...base,
			mode: 'posterize',
			posterizeLevels: 4,
			turdSize: noisyTurd(4),
			optTolerance: 0.2,
			blur: maybeBlur,
		};
	} else {
		cls = 'photo';
		reason = 'Imagem complexa sem regiões chapadas claras.';
		confidence = 0.6;
		recommendTool = 'engraving';
		params = {
			...base,
			mode: 'posterize',
			posterizeLevels: 6,
			turdSize: noisyTurd(6),
			optTolerance: 0.2,
			blur: maybeBlur,
		};
	}

	return {
		class: cls,
		label: LABELS[cls],
		reason,
		confidence,
		metrics: m,
		recommendedParams: params,
		recommendTool,
	};
}

// ─── API pública ─────────────────────────────────────────────────────

/**
 * Analisa a imagem (downscale interno p/ velocidade) e devolve o perfil +
 * parâmetros recomendados. Não grava nada e não depende de serviços externos.
 */
export async function analyzeImage(buffer: Buffer): Promise<ImageProfile> {
	const meta = await sharp(buffer).metadata();
	const width = meta.width ?? 0;
	const height = meta.height ?? 0;
	const hasAlpha = meta.hasAlpha ?? false;

	const work = sharp(buffer).resize({
		width: ANALYZE_DIM,
		height: ANALYZE_DIM,
		fit: 'inside',
		withoutEnlargement: true,
	});

	// RGB (sem alpha) p/ contagem de cores.
	const { data: rgb, info: rgbInfo } = await work
		.clone()
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const colorCount = countColors(rgb, rgbInfo.channels);

	// Cinza p/ histograma / Otsu / bordas.
	const { data: gray, info: gInfo } = await work
		.clone()
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const total = gray.length;
	const hist = histogram(gray);
	const otsuThreshold = otsu(hist, total);

	let sumGray = 0;
	let extreme = 0;
	let below = 0;
	for (let i = 0; i < 256; i++) {
		sumGray += i * hist[i];
		if (i < 51 || i > 204) extreme += hist[i];
		if (i < otsuThreshold) below += hist[i];
	}
	const meanGray = sumGray / total;
	const darkBackground = meanGray < 110;
	const belowRatio = below / total;
	const foregroundRatio = darkBackground ? 1 - belowRatio : belowRatio;
	const grayEntropy = entropyOf(hist, total);
	const { edgeDensity, noise } = edgeMetrics(gray, gInfo.width, gInfo.height);

	const metrics: ImageMetrics = {
		width,
		height,
		hasAlpha,
		colorCount,
		grayEntropy,
		otsuThreshold,
		bimodality: extreme / total,
		foregroundRatio,
		darkBackground,
		edgeDensity,
		noise,
	};

	return classify(metrics);
}
