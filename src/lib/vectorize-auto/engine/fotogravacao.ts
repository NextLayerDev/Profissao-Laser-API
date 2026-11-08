// Fotogravacao (photo engraving) preprocessing for laser marking on metal
// (e.g. stainless steel tumblers).
//
// Two kinds of input arrive here:
//   1. Fotos reais (tons continuos) — precisam virar meio-tom: normalizacao
//      tonal + dithering (Atkinson por padrao), que o laser reproduz como
//      densidade de pontos.
//   2. Arte ja em P&B estilo "nanquim vetorizado" (ex.: saida da IA do
//      LaserPro Foto, com hachuras finas e sombras solidas) — dithering aqui
//      DESTRUIRIA as hachuras; basta binarizar preservando cada linha fina.
// A rota e escolhida automaticamente pela distribuicao do histograma.
//
// Atencao: o sharp aplica as operacoes numa ORDEM FIXA interna (median →
// modulate → sharpen → gamma → linear → normalise → clahe → negate), nao na
// ordem das chamadas. Por isso os ajustes tonais rodam em estagios separados
// (cada um materializado em raw) — senao o normalize desfaz brilho/contraste.

import sharp, { type Sharp } from 'sharp';
import {
	applyDithering,
	type DitherAlgorithm,
	isDitherAlgorithm,
} from './dithering.js';
import { computeOtsuThreshold, detectBackgroundIsDark } from './laser.js';

// 'auto' → escolhido pela heuristica de tons (chooseDitherAlgorithm).
export type FotogravacaoDither = DitherAlgorithm | 'auto';

export interface FotogravacaoOptions {
	ditherAlgorithm: FotogravacaoDither; // usado apenas na rota de foto (tons continuos)
	maxDimension: number; // resolucao de trabalho — controla a densidade de pontos do meio-tom
	threshold: number | null; // null → Otsu (rota binaria) / 128 (dithering)
	invert: boolean | null; // null → auto-detect pelo fundo (cantos)
	blackOnWhite: boolean; // false → polaridade invertida: o vetor cobre os CLAROS
	brightness: number | null; // modulate (1 = neutro)
	contrast: number | null; // linear centrado em 128 (1 = neutro)
	gamma: number | null; // curva de tom (1 = neutro; >1 clareia meios-tons)
	clahe: boolean; // equalizacao local de contraste antes do dither
	denoise: number; // 0 desliga; 1-5 = janela do median antes do sharpen/dither
	sharpen: boolean;
	turdSize: number;
	optTolerance: number;
	alphaMax: number;
	coordPrecision: number;
}

// maxDimension 800 + coordPrecision 0 mantêm o pior caso (imagem inteira em
// meio-tom) abaixo do limite de resposta de ~4.5MB do host; 800px ≈ 200 DPI
// numa gravação de 100mm. A rota binária (nanquim) não passa pelo resize.
export const FOTOGRAVACAO_DEFAULTS: FotogravacaoOptions = {
	ditherAlgorithm: 'atkinson',
	maxDimension: 800,
	threshold: null,
	invert: null,
	blackOnWhite: true,
	brightness: null,
	contrast: null,
	gamma: null,
	clahe: false,
	denoise: 0,
	sharpen: true,
	turdSize: 0, // preserva cada ponto do dithering / cada hachura fina
	optTolerance: 0.2,
	alphaMax: 1.0,
	coordPrecision: 0,
};

export const FOTOGRAVACAO_MIN_DIMENSION = 400;
export const FOTOGRAVACAO_MAX_DIMENSION = 3000;
// Margem abaixo do limite de ~4.5MB de corpo de resposta do host.
export const FOTOGRAVACAO_MAX_SVG_BYTES = 4_300_000;
const CLAHE_MAX_SLOPE = 3;

// ─── Parse dos campos multipart ──────────────────────────────────────

type FormFields = { readonly [key: string]: string[] | undefined };

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

// Valor numerico do campo, ou null quando ausente/vazio/invalido.
function readNumber(fields: FormFields, key: string): number | null {
	const raw = fields[key]?.[0];
	if (raw === undefined || raw.trim() === '') return null;
	const parsed = Number.parseFloat(raw);
	return Number.isFinite(parsed) ? parsed : null;
}

function readClamped(
	fields: FormFields,
	key: string,
	min: number,
	max: number,
): number | null {
	const v = readNumber(fields, key);
	return v === null ? null : clamp(v, min, max);
}

// Le/valida/clampa todos os campos da fotogravacao. Sem nenhum campo, devolve
// exatamente FOTOGRAVACAO_DEFAULTS (com dither 'auto' quando autoParams != false).
// Os campos genericos (threshold, invert, brightness, turdSize...) sao
// reaproveitados quando enviados.
export function parseFotogravacaoOptions(
	fields: FormFields,
): FotogravacaoOptions {
	const fd = FOTOGRAVACAO_DEFAULTS;
	const autoParams = fields.autoParams?.[0] !== 'false';
	const ditherRaw = fields.ditherAlgorithm?.[0];
	const ditherAlgorithm: FotogravacaoDither = isDitherAlgorithm(ditherRaw)
		? ditherRaw
		: autoParams
			? 'auto'
			: fd.ditherAlgorithm;

	const threshold = readNumber(fields, 'threshold');
	const maxDimension = readClamped(
		fields,
		'photoMaxDimension',
		FOTOGRAVACAO_MIN_DIMENSION,
		FOTOGRAVACAO_MAX_DIMENSION,
	);
	const denoise = readClamped(fields, 'denoise', 0, 5);
	const coordPrecision = readClamped(fields, 'coordPrecision', 0, 2);
	const turdSize = readNumber(fields, 'turdSize');
	const optTolerance = readNumber(fields, 'optTolerance');
	const alphaMax = readNumber(fields, 'alphaMax');
	const invertRaw = fields.invert?.[0];

	return {
		ditherAlgorithm,
		maxDimension:
			maxDimension === null ? fd.maxDimension : Math.round(maxDimension),
		threshold: threshold === null ? null : clamp(Math.round(threshold), 0, 255),
		invert: invertRaw !== undefined ? invertRaw === 'true' : null,
		blackOnWhite: fields.blackOnWhite?.[0] !== 'false',
		brightness: readClamped(fields, 'brightness', 0.1, 3.0),
		contrast: readClamped(fields, 'contrast', 0.1, 3.0),
		gamma: readClamped(fields, 'gamma', 1.0, 3.0),
		clahe: fields.clahe?.[0] === 'true',
		denoise: denoise === null ? fd.denoise : Math.round(denoise),
		sharpen:
			fields.sharpen?.[0] !== undefined
				? fields.sharpen[0] === 'true'
				: fd.sharpen,
		turdSize: turdSize === null ? fd.turdSize : Math.max(0, turdSize),
		optTolerance:
			optTolerance === null ? fd.optTolerance : Math.max(0, optTolerance),
		alphaMax: alphaMax === null ? fd.alphaMax : Math.max(0, alphaMax),
		coordPrecision:
			coordPrecision === null ? fd.coordPrecision : Math.round(coordPrecision),
	};
}

// ─── Helpers de imagem ───────────────────────────────────────────────

function extractGrayChannel(data: Buffer, channels: number): Buffer {
	if (channels === 1) return data;
	const out = Buffer.allocUnsafe(Math.floor(data.length / channels));
	for (let i = 0, j = 0; i < data.length; i += channels, j++) out[j] = data[i];
	return out;
}

function negateGray(gray: Buffer): Buffer {
	const out = Buffer.allocUnsafe(gray.length);
	for (let i = 0; i < gray.length; i++) out[i] = 255 - gray[i];
	return out;
}

// A imagem e "quase binaria" quando os extremos do histograma concentram a
// massa dos pixels — caso da arte nanquim/hachura vinda da IA.
function isNearlyBinary(gray: Buffer): boolean {
	const hist = new Array(256).fill(0);
	for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
	const total = gray.length;
	if (total === 0) return false;
	let extremes = 0;
	for (let v = 0; v <= 12; v++) extremes += hist[v];
	for (let v = 243; v <= 255; v++) extremes += hist[v];
	return extremes / total > 0.88;
}

// Heuristica do dither automatico (gray ja normalizado, ~256px):
// muito meio-tom + pouca borda (retrato/pele/ceu) → stucki (bem liso) ou sierra (liso moderado),
// que difundem 100% do erro; Atkinson (descarta 1/4 do erro, mais contraste) fica como padrao.
export function chooseDitherAlgorithm(
	gray: Buffer,
	width: number,
	height: number,
): DitherAlgorithm {
	const total = width * height;
	if (total === 0 || width < 2 || height < 2) return 'atkinson';
	let midtones = 0;
	for (let i = 0; i < total; i++)
		if (gray[i] >= 40 && gray[i] <= 215) midtones++;
	let gradSum = 0;
	let gradCount = 0;
	for (let y = 0; y < height - 1; y++) {
		for (let x = 0; x < width - 1; x++) {
			const i = y * width + x;
			gradSum +=
				Math.abs(gray[i + 1] - gray[i]) + Math.abs(gray[i + width] - gray[i]);
			gradCount += 2;
		}
	}
	const midtoneRatio = midtones / total;
	const meanGradient = gradSum / gradCount;
	if (midtoneRatio >= 0.65 && meanGradient <= 6) return 'stucki';
	if (midtoneRatio >= 0.55 && meanGradient <= 12) return 'sierra';
	return 'atkinson';
}

async function runGrayStage(
	gray: Buffer,
	width: number,
	height: number,
	op: (s: Sharp) => Sharp,
): Promise<Buffer> {
	const { data, info } = await op(
		sharp(gray, { raw: { width, height, channels: 1 } }),
	)
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return extractGrayChannel(data, info.channels);
}

// Ajustes tonais em ordem explicita, cada um materializado: CLAHE → brilho →
// contraste → gamma. Sem nenhum ajuste, devolve o proprio buffer.
export async function applyToneAdjustments(
	gray: Buffer,
	width: number,
	height: number,
	opts: Pick<
		FotogravacaoOptions,
		'clahe' | 'brightness' | 'contrast' | 'gamma'
	>,
): Promise<Buffer> {
	let out = gray;
	if (opts.clahe) {
		const tile = Math.max(3, Math.round(Math.min(width, height) / 8));
		out = await runGrayStage(out, width, height, (s) =>
			s.clahe({ width: tile, height: tile, maxSlope: CLAHE_MAX_SLOPE }),
		);
	}
	const { brightness, contrast, gamma } = opts;
	if (brightness !== null) {
		out = await runGrayStage(out, width, height, (s) =>
			s.modulate({ brightness }),
		);
	}
	if (contrast !== null) {
		// Contraste linear centrado em 128: 128 fica fixo, >1 afasta, <1 aproxima.
		out = await runGrayStage(out, width, height, (s) =>
			s.linear(contrast, 128 * (1 - contrast)),
		);
	}
	if (gamma !== null) {
		// gamma(1, g): entrada neutra e curva de saida real (v^(1/g)). Um .gamma(g)
		// sozinho aplica 1/g antes do resize e g depois — praticamente identidade.
		out = await runGrayStage(out, width, height, (s) => s.gamma(1, gamma));
	}
	return out;
}

// Proximo maxDimension quando o SVG estoura o limite do host: o tamanho cresce
// ~ com a area (numero de pontos), entao escala pela raiz da razao, com folga.
// null → nao ha como reduzir (ja dentro do limite ou no minimo).
export function shrinkMaxDimensionForSvgSize(
	currentMaxDimension: number,
	svgBytes: number,
	limitBytes: number = FOTOGRAVACAO_MAX_SVG_BYTES,
): number | null {
	if (svgBytes <= limitBytes) return null;
	const next = Math.floor(
		currentMaxDimension * Math.sqrt(limitBytes / svgBytes) * 0.9,
	);
	const clamped = Math.max(FOTOGRAVACAO_MIN_DIMENSION, next);
	return clamped < currentMaxDimension ? clamped : null;
}

// ─── Pre-processamento ───────────────────────────────────────────────

export interface FotogravacaoPreprocessResult {
	threshold: number;
	inverted: boolean;
	dithered: boolean;
	ditherAlgorithm: DitherAlgorithm | null; // efetivamente usado (null na rota binaria)
	blackOnWhite: boolean;
}

// Produce a bilevel PNG ready for Potrace (traced black-on-white): dithered
// halftone for photos, crisp threshold for line-art (hachura) input. Com
// blackOnWhite=false o bitmap final sai negado — o vetor cobre os claros
// (polaridade invertida) sem mexer na deteccao de fundo (invert).
export async function preprocessFotogravacaoToFile(
	buffer: Buffer,
	opts: FotogravacaoOptions,
	outputPath: string,
	isAlreadyBinaryHint: boolean | null,
): Promise<FotogravacaoPreprocessResult> {
	// Orientacao do fundo (igual ao modo laser): garante marca escura p/ Potrace.
	let inverted: boolean;
	if (opts.invert !== null) {
		inverted = opts.invert;
	} else {
		const { data, info } = await sharp(buffer, { failOn: 'none' })
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		inverted = detectBackgroundIsDark(
			data,
			info.width,
			info.height,
			info.channels,
		);
	}

	const base = sharp(buffer, { failOn: 'none' })
		.flatten({ background: inverted ? '#000000' : '#ffffff' })
		.grayscale();

	// Decidir a rota olhando o histograma do grayscale plano.
	let alreadyBinary = isAlreadyBinaryHint ?? false;
	if (isAlreadyBinaryHint === null) {
		const { data: probeData, info: probeInfo } = await base
			.clone()
			.raw()
			.toBuffer({ resolveWithObject: true });
		alreadyBinary = isNearlyBinary(
			extractGrayChannel(probeData, probeInfo.channels),
		);
	}

	// ── ROTA BINARIA: arte nanquim/hachura — binariza sem dithering ──
	if (alreadyBinary) {
		let pipeline = base.clone();
		if (inverted) pipeline = pipeline.negate();
		const { data, info } = await pipeline
			.raw()
			.toBuffer({ resolveWithObject: true });
		const gray = extractGrayChannel(data, info.channels);
		const threshold = opts.threshold ?? computeOtsuThreshold(gray);
		let out = sharp(gray, {
			raw: { width: info.width, height: info.height, channels: 1 },
		}).threshold(threshold);
		if (!opts.blackOnWhite) out = out.negate(); // sharp roda negate depois do threshold
		await out.png().toFile(outputPath);
		return {
			threshold,
			inverted,
			dithered: false,
			ditherAlgorithm: null,
			blackOnWhite: opts.blackOnWhite,
		};
	}

	// ── ROTA FOTO: preparo tonal + dithering (meio-tom p/ gravacao) ──
	// Estagio 1 (ordem interna do sharp): resize → median → sharpen → normalize.
	let stage = base
		.clone()
		.resize(opts.maxDimension, opts.maxDimension, {
			fit: 'inside',
			withoutEnlargement: false,
			kernel: 'lanczos3',
		})
		.normalize();
	if (opts.denoise > 0) stage = stage.median(opts.denoise);
	if (opts.sharpen) stage = stage.sharpen({ sigma: 1 });

	const { data, info } = await stage
		.raw()
		.toBuffer({ resolveWithObject: true });
	const { width, height } = info;
	let gray = extractGrayChannel(data, info.channels);

	// Estagio 2: CLAHE → brilho → contraste → gamma (so quando pedidos).
	gray = await applyToneAdjustments(gray, width, height, opts);
	if (inverted) gray = negateGray(gray);

	let ditherAlgorithm: DitherAlgorithm;
	if (opts.ditherAlgorithm === 'auto') {
		const { data: small, info: smallInfo } = await sharp(gray, {
			raw: { width, height, channels: 1 },
		})
			.resize(256, 256, { fit: 'inside' })
			.grayscale()
			.raw()
			.toBuffer({ resolveWithObject: true });
		ditherAlgorithm = chooseDitherAlgorithm(
			extractGrayChannel(small, smallInfo.channels),
			smallInfo.width,
			smallInfo.height,
		);
	} else {
		ditherAlgorithm = opts.ditherAlgorithm;
	}

	const threshold = opts.threshold ?? 128;
	let dithered = applyDithering(
		gray,
		width,
		height,
		ditherAlgorithm,
		threshold,
	);
	if (!opts.blackOnWhite) dithered = negateGray(dithered);
	await sharp(dithered, { raw: { width, height, channels: 1 } })
		.png()
		.toFile(outputPath);
	return {
		threshold,
		inverted,
		dithered: true,
		ditherAlgorithm,
		blackOnWhite: opts.blackOnWhite,
	};
}
