import * as Potrace from 'potrace';
import sharp from 'sharp';
import type { VectorizeParams } from '../types/vector.js';
import { applyDithering } from './dithering.js';
import { applyLinePattern } from './line-patterns.js';
import { lineArtRaster } from './lineart.js';
import { vectorizeColorImage } from './vectorize-color.js';

// ─── Tipos internos (Potrace usa `turnPolicy`; @types/potrace expõe nome
//     diferente, então mantemos uma interface própria e fazemos cast) ──
interface PotraceParams {
	turdSize?: number;
	turnPolicy?: string;
	alphaMax?: number;
	optCurve?: boolean;
	optTolerance?: number;
	threshold?: number;
	blackOnWhite?: boolean;
	background?: string;
	color?: string;
}

interface PosterizerParams extends PotraceParams {
	steps?: number;
	fillStrategy?: string;
	rangeDistribution?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Campo numérico OPCIONAL de multipart. Devolve null quando ausente OU quando
 * não é um número — sem isto, qualquer string malformada (`"null"`, `"abc"`,
 * `""` já é tratado pelo falsy) escapa como NaN: `parseFloat("null")` é NaN e o
 * `clamp` o preserva (NaN falha as duas comparações), e o sharp acaba recebendo
 * `.blur(NaN)`.
 */
function optNum(
	raw: string | undefined,
	min: number,
	max: number,
): number | null {
	if (!raw) return null;
	const v = Number.parseFloat(raw);
	return Number.isFinite(v) ? clamp(v, min, max) : null;
}

function pick<T extends string>(
	value: string | undefined,
	allowed: readonly T[],
	fallback: T,
): T {
	return value && (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback;
}

function pickOrNull<T extends string>(
	value: string | undefined,
	allowed: readonly T[],
): T | null {
	return value && (allowed as readonly string[]).includes(value)
		? (value as T)
		: null;
}

/**
 * Lê os campos multipart (strings) e devolve os parâmetros tipados do motor.
 * Porte do `parseParams` do site_nextlayer (mesmos defaults e clamps).
 */
export function parseVectorizeParams(
	fields: Record<string, string>,
): VectorizeParams {
	const turdSize = parseFloat(fields.turdSize || '5.0');
	const optTolerance = parseFloat(fields.optTolerance || '0.2');
	const alphaMax = parseFloat(fields.alphaMax || '1.0');
	const drawingStyle = pick(
		fields.drawingStyle,
		['fill', 'stroke', 'outline'] as const,
		'fill',
	);
	const color = fields.color || '#000000';
	const strokeWidth = parseFloat(fields.strokeWidth || '1.0');
	const nonScalingStroke = fields.nonScalingStroke === 'true';

	const threshold = clamp(parseInt(fields.threshold || '128', 10), 0, 255);
	const invert = fields.invert === 'true';
	const blur = optNum(fields.blur, 0.3, 20);
	const sharpen = fields.sharpen === 'true';
	const brightness = optNum(fields.brightness, 0.1, 3.0);
	const contrast = optNum(fields.contrast, 0.1, 3.0);
	const gamma = optNum(fields.gamma, 1.0, 3.0);

	const turnPolicy = pickOrNull(fields.turnPolicy, [
		'black',
		'white',
		'left',
		'right',
		'minority',
		'majority',
	] as const);
	const blackOnWhite = fields.blackOnWhite !== 'false';

	const mode = pick(
		fields.mode,
		['trace', 'posterize', 'color'] as const,
		'trace',
	);
	const maxColors = clamp(parseInt(fields.maxColors || '8', 10), 2, 16);
	const posterizeLevels = clamp(
		parseInt(fields.posterizeLevels || '4', 10),
		2,
		10,
	);
	const posterizeFillStrategy = pick(
		fields.posterizeFillStrategy,
		['dominant', 'mean', 'median', 'spread'] as const,
		'dominant',
	);
	const posterizeRangeDistribution = pick(
		fields.posterizeRangeDistribution,
		['auto', 'equal'] as const,
		'auto',
	);

	const ditherAlgorithm = pickOrNull(fields.ditherAlgorithm, [
		'floydSteinberg',
		'atkinson',
		'stucki',
		'jarvis',
		'sierra',
		'ordered',
		'halftone',
	] as const);

	const linePattern = pick(
		fields.linePattern,
		[
			'none',
			'horizontal',
			'vertical',
			'diagonal45',
			'diagonal135',
			'crosshatch',
			'diamondHatch',
		] as const,
		'none',
	);
	const lineSpacing = clamp(parseFloat(fields.lineSpacing || '3'), 0.5, 10);
	const lineAngle = optNum(fields.lineAngle, 0, 360);

	const dpiRaw = optNum(fields.dpi, 72, 360);
	const dpi = dpiRaw === null ? null : Math.round(dpiRaw);
	// Dimensão de saída em mm: sem teto rígido, mas precisa ser finita e > 0 —
	// um NaN aqui vira `width="NaNmm"` no SVG e o arquivo não abre no laser.
	const outputWidth = optNum(fields.outputWidth, 0.01, Number.MAX_SAFE_INTEGER);
	const outputHeight = optNum(
		fields.outputHeight,
		0.01,
		Number.MAX_SAFE_INTEGER,
	);
	const svgOptimize = fields.svgOptimize === 'true';
	const healHoles = fields.healHoles === 'true';
	const subject = pickOrNull(fields.subject, [
		'photo',
		'logo',
		'color',
	] as const);

	const edgeDetection = pick(
		fields.edgeDetection,
		['none', 'sobel', 'canny', 'lineart'] as const,
		'none',
	);

	const preset =
		pickOrNull(fields.preset, ['rapido', 'detalhado', 'svg'] as const) ??
		undefined;

	return {
		preset,
		turdSize,
		optTolerance,
		alphaMax,
		drawingStyle,
		color,
		strokeWidth,
		nonScalingStroke,
		threshold,
		invert,
		blur,
		sharpen,
		brightness,
		contrast,
		gamma,
		turnPolicy,
		blackOnWhite,
		mode,
		maxColors,
		posterizeLevels,
		posterizeFillStrategy,
		posterizeRangeDistribution,
		ditherAlgorithm,
		linePattern,
		lineSpacing,
		lineAngle,
		dpi,
		outputWidth,
		outputHeight,
		svgOptimize,
		healHoles,
		subject,
		edgeDetection,
	};
}

// ─── Pré-processamento (sharp) → Buffer PNG (sem arquivos temporários) ──

async function preprocessImage(
	buffer: Buffer,
	params: VectorizeParams,
): Promise<Buffer> {
	// Fundo transparente → BRANCO (não grava). Sem isso, arte preta sobre
	// transparente era lida como tudo-preto e o resultado saía vazio/errado.
	// `flatten` é no-op em imagens sem alpha.
	const FLAT_BG = { background: '#ffffff' as const };

	// Posterize: preserva cores para o Potrace.posterize()
	if (params.mode === 'posterize') {
		let pipeline = sharp(buffer).flatten(FLAT_BG);
		if (params.blur !== null) pipeline = pipeline.blur(params.blur);
		if (params.sharpen) pipeline = pipeline.sharpen();
		if (params.invert) pipeline = pipeline.negate();
		return pipeline.png().toBuffer();
	}

	const hasDithering = params.ditherAlgorithm !== null;
	const hasPreprocessing =
		params.brightness !== null ||
		params.contrast !== null ||
		params.gamma !== null ||
		params.blur !== null ||
		params.sharpen ||
		params.edgeDetection !== 'none' ||
		params.invert;

	// Caminho rápido: sem novos parâmetros → comportamento original
	if (!hasDithering && !hasPreprocessing && params.threshold === 128) {
		return sharp(buffer).flatten(FLAT_BG).threshold(128).png().toBuffer();
	}

	let pipeline = sharp(buffer).flatten(FLAT_BG).grayscale();

	// Auto-níveis: estica o range tonal p/ preto/branco reais. Scans e fotos
	// "lavadas" (baixo contraste) ganham separação antes do limiar — é o maior
	// ganho barato de qualidade e faz o Otsu/threshold cair no lugar certo.
	pipeline = pipeline.normalize();

	if (params.brightness !== null) {
		pipeline = pipeline.modulate({ brightness: params.brightness });
	}

	if (params.contrast !== null) {
		// Contraste REAL em torno do cinza médio (128). Antes usava gamma=1/contrast
		// clampado a >=1.0, o que tornava QUALQUER contraste > 1 um no-op (bug).
		pipeline = pipeline.linear(params.contrast, 128 * (1 - params.contrast));
	}

	if (params.gamma !== null) {
		pipeline = pipeline.gamma(params.gamma);
	}

	if (params.blur !== null) {
		// Imagem ruidosa (o analyzer seta `blur` quando detecta ruído): a mediana
		// remove speckle/ruído JPEG preservando bordas melhor que só o blur — senão
		// o ruído vira centenas de <path> (turds). Depois o blur suaviza o resto.
		pipeline = pipeline.median(3).blur(params.blur);
	}

	if (params.sharpen) {
		pipeline = pipeline.sharpen();
	}

	if (params.edgeDetection === 'lineart') {
		// Line-art (XDoG): foto/imagem complexa → TRAÇOS limpos pretos sobre branco,
		// sem IA. Roda sobre o cinza já normalizado/denoised e devolve o raster de
		// linhas (early-return: pula invert/dither/threshold; o Potrace vetoriza as
		// linhas). É o fix do "P&B de foto sai ruim" (posterize → traço).
		const { data, info } = await pipeline
			.toColourspace('b-w')
			.raw()
			.toBuffer({ resolveWithObject: true });
		// Default "contorno limpo": limiar médio + traços engrossados/conectados
		// (melhor p/ gravação — linha fina e quebrada grava mal).
		return lineArtRaster(Buffer.from(data), info.width, info.height, {
			threshold: 8,
			thicken: true,
		});
	}

	if (params.edgeDetection === 'sobel' || params.edgeDetection === 'canny') {
		if (params.edgeDetection === 'canny' && params.blur === null) {
			pipeline = pipeline.blur(1.4);
		}
		pipeline = pipeline.convolve({
			width: 3,
			height: 3,
			kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
		});
	}

	if (params.invert) {
		pipeline = pipeline.negate();
	}

	if (hasDithering) {
		// força 1 canal para o dithering ler 1 byte por pixel
		const { data, info } = await pipeline
			.toColourspace('b-w')
			.raw()
			.toBuffer({ resolveWithObject: true });
		const dithered = applyDithering(
			Buffer.from(data),
			info.width,
			info.height,
			// biome-ignore lint/style/noNonNullAssertion: guardado por hasDithering
			params.ditherAlgorithm!,
			params.threshold,
		);
		return sharp(dithered, {
			raw: { width: info.width, height: info.height, channels: 1 },
		})
			.png()
			.toBuffer();
	}

	return pipeline.threshold(params.threshold).png().toBuffer();
}

// ─── Vetorização (Potrace recebe Buffer diretamente) ─────────────────

function traceImage(image: Buffer, params: VectorizeParams): Promise<string> {
	const potraceParams: PotraceParams = {
		turdSize: params.turdSize,
		optTolerance: params.optTolerance,
		alphaMax: params.alphaMax,
		optCurve: true,
		color: params.drawingStyle === 'fill' ? params.color : 'transparent',
		background: 'transparent',
		blackOnWhite: params.blackOnWhite,
	};

	if (params.turnPolicy !== null) {
		potraceParams.turnPolicy = params.turnPolicy;
	}

	return new Promise((resolve, reject) => {
		Potrace.trace(
			image,
			potraceParams as Potrace.PotraceOptions,
			(err: Error | null, svg: string) => {
				if (err) return reject(err);
				if (!svg) return reject(new Error('SVG generation failed'));
				resolve(svg);
			},
		);
	});
}

function posterizeImage(
	image: Buffer,
	params: VectorizeParams,
): Promise<string> {
	const posterizeParams: PosterizerParams = {
		turdSize: params.turdSize,
		optTolerance: params.optTolerance,
		alphaMax: params.alphaMax,
		optCurve: true,
		color: params.drawingStyle === 'fill' ? params.color : 'transparent',
		background: 'transparent',
		blackOnWhite: params.blackOnWhite,
		steps: params.posterizeLevels,
		fillStrategy: params.posterizeFillStrategy,
		rangeDistribution: params.posterizeRangeDistribution,
	};

	if (params.turnPolicy !== null) {
		posterizeParams.turnPolicy = params.turnPolicy;
	}

	return new Promise((resolve, reject) => {
		Potrace.posterize(
			image,
			posterizeParams as Potrace.PosterizerOptions,
			(err: Error | null, svg: string) => {
				if (err) return reject(err);
				if (!svg) return reject(new Error('SVG generation failed'));
				resolve(svg);
			},
		);
	});
}

// ─── Pós-processamento do SVG ────────────────────────────────────────

function applySvgDimensions(svg: string, params: VectorizeParams): string {
	const widthMatch = svg.match(/width="(\d+(?:\.\d+)?)"/);
	const heightMatch = svg.match(/height="(\d+(?:\.\d+)?)"/);
	if (!widthMatch || !heightMatch) return svg;

	const pxWidth = parseFloat(widthMatch[1]);
	const pxHeight = parseFloat(heightMatch[1]);

	let newWidth: string;
	let newHeight: string;

	if (params.outputWidth !== null && params.outputHeight !== null) {
		newWidth = `${params.outputWidth}mm`;
		newHeight = `${params.outputHeight}mm`;
	} else if (params.outputWidth !== null) {
		const scale = params.outputWidth / pxWidth;
		newWidth = `${params.outputWidth}mm`;
		newHeight = `${(pxHeight * scale).toFixed(2)}mm`;
	} else if (params.outputHeight !== null) {
		const scale = params.outputHeight / pxHeight;
		newWidth = `${(pxWidth * scale).toFixed(2)}mm`;
		newHeight = `${params.outputHeight}mm`;
	} else if (params.dpi !== null) {
		newWidth = `${((pxWidth / params.dpi) * 25.4).toFixed(2)}mm`;
		newHeight = `${((pxHeight / params.dpi) * 25.4).toFixed(2)}mm`;
	} else {
		return svg;
	}

	let result = svg.replace(/width="\d+(?:\.\d+)?"/, `width="${newWidth}"`);
	result = result.replace(/height="\d+(?:\.\d+)?"/, `height="${newHeight}"`);
	return result;
}

function simplifySvgPaths(svg: string): string {
	return svg.replace(/(\d+\.\d{2})\d+/g, '$1');
}

/** Remove elementos <path> byte-idênticos repetidos (sobreposição exata). */
function dedupeSvgPaths(svg: string): string {
	const seen = new Set<string>();
	return svg.replace(/<path\b[^>]*\/?>/g, (m) => {
		if (seen.has(m)) return '';
		seen.add(m);
		return m;
	});
}

function postProcessSvg(svg: string, params: VectorizeParams): string {
	let result = svg;

	// 1. Stroke styles
	if (params.drawingStyle === 'stroke' || params.drawingStyle === 'outline') {
		const strokeAttributes = `stroke="${params.color}" stroke-width="${params.strokeWidth}"${params.nonScalingStroke ? ' vector-effect="non-scaling-stroke"' : ''}`;
		// Global em ambos os modos: o trace costuma emitir vários <path> (contornos
		// externos + buracos). Antes, o modo trace usava replace de string (só a 1ª
		// ocorrência), deixando os demais paths preenchidos → traços duplicados/sujos.
		result = result.replace(/<path/g, `<path fill="none" ${strokeAttributes}`);
	}

	// 2. Padrões de linha
	if (params.linePattern !== 'none') {
		result = applyLinePattern(result, {
			pattern: params.linePattern,
			spacing: params.lineSpacing,
			angle: params.lineAngle ?? undefined,
			strokeWidth: params.strokeWidth,
			color: params.color,
		});
	}

	// 3. DPI / dimensões
	if (
		params.dpi !== null ||
		params.outputWidth !== null ||
		params.outputHeight !== null
	) {
		result = applySvgDimensions(result, params);
	}

	// 4. Otimização do SVG — sempre corta casas decimais sub-pixel excedentes:
	// SVG bem menor e ajuda o dedupe a casar paths quase-idênticos entre camadas.
	result = simplifySvgPaths(result);

	// 5. Remove paths idênticos sobrepostos (limpa duplicatas exatas).
	result = dedupeSvgPaths(result);

	return result;
}

// ─── API pública do motor ────────────────────────────────────────────

const TRACE_MIN_DIM = 1400; // piso de resolução p/ tracing suave
const TRACE_MAX_UPSCALE = 3; // teto de ampliação

/**
 * Supersampling: imagens pequenas viram serrilhadas no threshold/trace, o que
 * quebra fontes e distorce logos simples. Damos upscale (lanczos, com
 * anti-alias) até um piso de resolução ANTES de binarizar/traçar — o Potrace
 * ganha mais pixels e devolve curvas bem mais suaves (qualidade tipo LightBurn).
 * Devolve o fator de escala p/ reajustar o turdSize (que é uma ÁREA em px).
 */
async function upscaleForTrace(
	buffer: Buffer,
	allow: boolean,
): Promise<{ buffer: Buffer; scale: number }> {
	if (!allow) return { buffer, scale: 1 };
	const meta = await sharp(buffer).metadata();
	const w = meta.width ?? 0;
	const h = meta.height ?? 0;
	const maxDim = Math.max(w, h);
	if (!maxDim || maxDim >= TRACE_MIN_DIM) return { buffer, scale: 1 };
	const scale = Math.min(TRACE_MAX_UPSCALE, TRACE_MIN_DIM / maxDim);
	const out = await sharp(buffer)
		.resize({ width: Math.round(w * scale), kernel: 'lanczos3' })
		.toBuffer();
	return { buffer: out, scale };
}

/**
 * Margem branca antes de traçar. Quando a arte ENCOSTA na borda da imagem (a IA
 * quase sempre compõe o busto saindo do quadro), o Potrace fecha o traçado rente
 * ao limite em vez de contornar a figura: o contorno externo sai partido em
 * vários subpaths, com vértices grudados na borda. Uma faixa branca em volta faz
 * o contorno fechar sozinho.
 *
 * Medido: blob encostando em 3 bordas → sem margem, 2 subpaths e 11 vértices na
 * borda; com margem, 1 subpath e nenhum.
 */
async function padForTrace(buffer: Buffer, allow: boolean): Promise<Buffer> {
	if (!allow) return buffer;
	const meta = await sharp(buffer).metadata();
	const maxDim = Math.max(meta.width ?? 0, meta.height ?? 0);
	if (!maxDim) return buffer;
	const pad = Math.max(6, Math.round(maxDim * 0.01));
	return sharp(buffer)
		.extend({
			top: pad,
			bottom: pad,
			left: pad,
			right: pad,
			background: { r: 255, g: 255, b: 255, alpha: 1 },
		})
		.png()
		.toBuffer();
}

/**
 * Teto do buraco preenchível, como fração da área da imagem. Acima disso a
 * região branca é tratada como intencional (contraforma de letra, vazado de
 * logo, realce) e fica intacta.
 */
const HOLE_MAX_AREA = 0.001;

/**
 * Teto de QUANTOS buracos fechados a imagem pode ter pra ainda contar como
 * "defeito isolado de geração". Medido numa gravura densa/estipulada real:
 * 14.668 buracos fechados, 99,8% deles com 1-20px² — são as frestas entre
 * hachuras cruzadas, que numa malha bem fina ficam TOTALMENTE cercadas de
 * tinta (não tocam a borda), então passam no teste de "buraco fechado" que
 * `fillEnclosedHoles` usa pra decidir defeito. Preencher milhares deles apaga
 * a hachura inteira e vira bolha sólida — exatamente o "perde muito a
 * qualidade" relatado. Defeito de geração de verdade é raro e isolado (a
 * IA "às vezes" deixa uma mancha, não uma malha inteira de furinhos) — acima
 * deste teto, a imagem inteira fica intocada.
 */
const MAX_HOLE_CANDIDATES = 40;

/**
 * Preenche BURACOS BRANCOS FECHADOS dentro da arte já binarizada.
 *
 * A IA às vezes deixa manchas brancas vazias no meio da figura — pedaços de
 * gravura que faltaram. Um `close` morfológico resolveria, mas fundiria as
 * linhas de hachura e destruiria o sombreado. Aqui a operação é local e
 * provavelmente invisível: um buraco FECHADO é, por definição, cercado de
 * preto, então preenchê-lo de preto se funde com o entorno.
 *
 * Não toca as frestas entre hachuras NORMAIS: essas se conectam ao fundo e
 * portanto não são "fechadas". Não toca o contorno externo. Não toca área
 * branca grande. Numa malha de hachura MUITO fina/cruzada, porém, as frestas
 * viram milhares de células isoladas (fechadas de verdade) — `MAX_HOLE_CANDIDATES`
 * é a proteção pra esse caso: acima do teto de quantidade, não mexe em nada.
 */
function fillEnclosedHoles(data: Uint8Array, W: number, H: number): number {
	const N = W * H;
	const maxArea = Math.max(16, Math.round(N * HOLE_MAX_AREA));
	const label = new Int32Array(N).fill(-1);
	const stack = new Int32Array(N);
	const sizeBySeed = new Map<number, number>();
	const edgeSeeds = new Set<number>();

	for (let seed = 0; seed < N; seed++) {
		if (data[seed] < 128 || label[seed] >= 0) continue;
		let sp = 0;
		let count = 0;
		let touchesEdge = false;
		stack[sp++] = seed;
		label[seed] = seed;
		while (sp > 0) {
			const i = stack[--sp];
			count++;
			const x = i % W;
			const y = (i / W) | 0;
			if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesEdge = true;
			// A inundação NUNCA é interrompida cedo: parar deixaria pixels sem
			// rótulo, que seriam re-semeados como componentes falsos e parte do
			// fundo viraria "buraco". O custo total continua O(N) — cada pixel é
			// rotulado uma vez só, somando todos os componentes.
			const nb = [
				x > 0 ? i - 1 : -1,
				x < W - 1 ? i + 1 : -1,
				y > 0 ? i - W : -1,
				y < H - 1 ? i + W : -1,
			];
			for (const j of nb) {
				if (j >= 0 && data[j] >= 128 && label[j] < 0) {
					label[j] = seed;
					stack[sp++] = j;
				}
			}
		}
		sizeBySeed.set(seed, count);
		if (touchesEdge) edgeSeeds.add(seed);
	}

	// Decide ANTES de preencher: quantos buracos fechados (dentro do teto de
	// área) existem no total? Só preenche se essa contagem for compatível com
	// "defeito isolado" — não com uma malha de hachura inteira.
	let candidateCount = 0;
	for (const [seed, count] of sizeBySeed) {
		if (!edgeSeeds.has(seed) && count <= maxArea) candidateCount++;
	}
	if (candidateCount === 0 || candidateCount > MAX_HOLE_CANDIDATES) return 0;

	for (let i = 0; i < N; i++) {
		const seed = label[i];
		if (seed < 0 || edgeSeeds.has(seed)) continue;
		if ((sizeBySeed.get(seed) ?? 0) <= maxArea) data[i] = 0;
	}
	return candidateCount;
}

/** Aplica `fillEnclosedHoles` num PNG já binarizado. */
async function healHolesInPng(buffer: Buffer): Promise<Buffer> {
	const { data, info } = await sharp(buffer)
		.grayscale()
		.toColourspace('b-w')
		.raw()
		.toBuffer({ resolveWithObject: true });
	const px = new Uint8Array(
		data.buffer,
		data.byteOffset,
		info.width * info.height,
	);
	const filled = fillEnclosedHoles(px, info.width, info.height);
	if (filled === 0) return buffer;
	return sharp(px, {
		raw: { width: info.width, height: info.height, channels: 1 },
	})
		.png()
		.toBuffer();
}

export interface VectorizeOptions {
	/** Liga o supersampling de qualidade (run final). Desligue p/ preview rápido. */
	supersample?: boolean;
	/**
	 * Liga a margem branca antes de traçar (evita contorno partido na borda).
	 * Desligue quando o CHAMADOR precisa saber exatamente o fator de escala/
	 * deslocamento entre o raster de entrada e o `d` do SVG resultante (ex.:
	 * `silhouettePath` em `vector-invert.ts`, que remonta o outline traçado de
	 * volta pro espaço de coordenadas do vetor original) — com upscale/margem
	 * internos, esse remonte fica sem como saber o fator certo e desalinha.
	 */
	pad?: boolean;
}

/**
 * Pré-processa, vetoriza (trace/posterize) e pós-processa, devolvendo o SVG.
 * Opera totalmente em memória (Buffer), sem arquivos temporários.
 */
export async function vectorizeImage(
	buffer: Buffer,
	params: VectorizeParams,
	opts: VectorizeOptions = {},
): Promise<string> {
	// Cores: pipeline próprio (quantização + máscara por cor + trace em camadas).
	// Preview (supersample=false) usa resolução menor p/ rapidez.
	if (params.mode === 'color') {
		// Run final em resolução maior (1200) = máscaras mais detalhadas e curvas
		// mais suaves nas cores (equivale ao supersampling do trace). Preview em 500.
		const svg = await vectorizeColorImage(buffer, params, {
			maxDim: opts.supersample === false ? 500 : 1400,
		});
		return postProcessSvg(svg, params);
	}

	// Só faz upscale no modo trace e quando o usuário NÃO pediu dimensão de saída
	// (dpi/mm) — assim não interfere no dimensionamento do SVG.
	const canUpscale =
		opts.supersample !== false &&
		params.mode === 'trace' &&
		params.dpi === null &&
		params.outputWidth === null &&
		params.outputHeight === null;
	const { buffer: scaled, scale } = await upscaleForTrace(buffer, canUpscale);
	// turdSize é área em px: ao ampliar ×s a área cresce ×s² → reescala p/ manter
	// a mesma supressão de manchas em escala real. EXCEÇÃO: line-art são TRAÇOS
	// finos (não áreas chapadas) — inflar por s² apagaria as linhas; mantém o turd.
	const effParams =
		scale > 1 && params.edgeDetection !== 'lineart'
			? { ...params, turdSize: params.turdSize * scale * scale }
			: params;

	// Margem: vale p/ trace E posterize (ambos passam pelo Potrace), inclusive no
	// preview — assim a prévia mostra o mesmo contorno do resultado final. Só a
	// guarda de dimensão exata (dpi/mm) permanece: com ela, mexer na geometria
	// encolheria a arte dentro do envelope pedido.
	const canPad =
		opts.pad !== false &&
		params.dpi === null &&
		params.outputWidth === null &&
		params.outputHeight === null;

	const processed = await preprocessImage(scaled, effParams);
	// Tapa buracos brancos fechados que a IA deixa no meio da figura. Opt-in
	// (`healHoles`) e ligado só na gravura de FOTO: em logo/texto a contraforma
	// de letra também é buraco fechado e seria destruída.
	const healed =
		effParams.healHoles && effParams.mode === 'trace'
			? await healHolesInPng(processed)
			: processed;
	// DEPOIS de binarizar: a faixa entra como branco puro e nada mais a reprocessa.
	const padded = await padForTrace(healed, canPad);
	const svg =
		effParams.mode === 'posterize'
			? await posterizeImage(padded, effParams)
			: await traceImage(padded, effParams);
	return postProcessSvg(svg, params);
}

// ─── SVG → DXF (achata os paths em LWPOLYLINE) ───────────────────────

interface DxfPoint {
	x: number;
	y: number;
}
interface DxfSubPath {
	points: DxfPoint[];
	closed: boolean;
}

function sampleCubic(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	x3: number,
	y3: number,
): DxfPoint[] {
	const pts: DxfPoint[] = [];
	const steps = 16;
	for (let s = 1; s <= steps; s++) {
		const t = s / steps;
		const mt = 1 - t;
		const a = mt * mt * mt;
		const b = 3 * mt * mt * t;
		const c = 3 * mt * t * t;
		const d = t * t * t;
		pts.push({
			x: a * x0 + b * x1 + c * x2 + d * x3,
			y: a * y0 + b * y1 + c * y2 + d * y3,
		});
	}
	return pts;
}

function parsePathData(d: string): DxfSubPath[] {
	const subpaths: DxfSubPath[] = [];
	let current: DxfSubPath | null = null;
	let cx = 0;
	let cy = 0;
	let startX = 0;
	let startY = 0;

	const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
	let i = 0;
	let cmd = '';
	const num = () => parseFloat(tokens[i++]);

	while (i < tokens.length) {
		if (/[a-zA-Z]/.test(tokens[i])) {
			cmd = tokens[i];
			i++;
		}
		const rel = cmd === cmd.toLowerCase();
		const C = cmd.toUpperCase();

		if (C === 'M') {
			let x = num();
			let y = num();
			if (rel) {
				x += cx;
				y += cy;
			}
			cx = x;
			cy = y;
			startX = x;
			startY = y;
			if (current) subpaths.push(current);
			current = { points: [{ x, y }], closed: false };
			cmd = rel ? 'l' : 'L'; // implícitos viram lineto
		} else if (C === 'L') {
			let x = num();
			let y = num();
			if (rel) {
				x += cx;
				y += cy;
			}
			cx = x;
			cy = y;
			current?.points.push({ x, y });
		} else if (C === 'H') {
			let x = num();
			if (rel) x += cx;
			cx = x;
			current?.points.push({ x, y: cy });
		} else if (C === 'V') {
			let y = num();
			if (rel) y += cy;
			cy = y;
			current?.points.push({ x: cx, y });
		} else if (C === 'C') {
			let x1 = num();
			let y1 = num();
			let x2 = num();
			let y2 = num();
			let x = num();
			let y = num();
			if (rel) {
				x1 += cx;
				y1 += cy;
				x2 += cx;
				y2 += cy;
				x += cx;
				y += cy;
			}
			if (current) {
				for (const p of sampleCubic(cx, cy, x1, y1, x2, y2, x, y)) {
					current.points.push(p);
				}
			}
			cx = x;
			cy = y;
		} else if (C === 'Z') {
			if (current) {
				current.closed = true;
				subpaths.push(current);
				current = null;
			}
			cx = startX;
			cy = startY;
		} else {
			// comando não suportado (Q/S/A/...) — avança p/ evitar loop
			i++;
		}
	}

	if (current) subpaths.push(current);
	return subpaths;
}

function parseSvgHeight(svg: string): number {
	const hMatch = svg.match(/height="([\d.]+)/);
	if (hMatch) return parseFloat(hMatch[1]);
	const vb = svg.match(/viewBox="[\d.]+ [\d.]+ [\d.]+ ([\d.]+)/);
	if (vb) return parseFloat(vb[1]);
	return 0;
}

/**
 * Converte o SVG vetorizado em DXF (entidades LWPOLYLINE). Achata curvas
 * cúbicas em segmentos. Coordenadas em unidades do SVG, com Y invertido
 * (SVG cresce p/ baixo; DXF p/ cima). Conversão aproximada.
 */
export function svgToDxf(svg: string): string {
	const pathDs: string[] = [];
	const re = /<path[^>]*\sd="([^"]+)"/g;
	let m: RegExpExecArray | null = re.exec(svg);
	while (m !== null) {
		pathDs.push(m[1]);
		m = re.exec(svg);
	}

	const subpaths = pathDs
		.flatMap(parsePathData)
		.filter((sp) => sp.points.length >= 2);

	// altura p/ inverter Y; fallback = maior Y encontrado
	let maxY = 0;
	for (const sp of subpaths) {
		for (const p of sp.points) if (p.y > maxY) maxY = p.y;
	}
	const flipH = parseSvgHeight(svg) || maxY;

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxYy = Number.NEGATIVE_INFINITY;

	const entities: string[] = [];
	for (const sp of subpaths) {
		entities.push(
			'0',
			'LWPOLYLINE',
			'8',
			'0',
			'100',
			'AcDbEntity',
			'100',
			'AcDbPolyline',
			'90',
			String(sp.points.length),
			'70',
			sp.closed ? '1' : '0',
		);
		for (const p of sp.points) {
			const x = p.x;
			const y = flipH - p.y;
			entities.push('10', x.toFixed(4), '20', y.toFixed(4));
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxYy) maxYy = y;
		}
	}

	if (!Number.isFinite(minX)) {
		minX = 0;
		minY = 0;
		maxX = 0;
		maxYy = 0;
	}

	return [
		'0\nSECTION',
		'2\nHEADER',
		'9\n$ACADVER\n1\nAC1015',
		'9\n$DWGCODEPAGE\n3\nANSI_1252',
		'9\n$INSUNITS\n70\n0',
		`9\n$EXTMIN\n10\n${minX.toFixed(4)}\n20\n${minY.toFixed(4)}\n30\n0.0`,
		`9\n$EXTMAX\n10\n${maxX.toFixed(4)}\n20\n${maxYy.toFixed(4)}\n30\n0.0`,
		'0\nENDSEC',
		'0\nSECTION',
		'2\nTABLES',
		'0\nTABLE\n2\nLAYER\n5\n2\n100\nAcDbSymbolTable\n70\n1',
		'0\nLAYER\n5\n10\n100\nAcDbSymbolTableRecord\n100\nAcDbLayerTableRecord',
		'2\n0\n70\n0\n62\n7\n6\nContinuous',
		'0\nENDTAB',
		'0\nENDSEC',
		'0\nSECTION',
		'2\nENTITIES',
		...entities,
		'0\nENDSEC',
		'0\nSECTION',
		'2\nOBJECTS',
		'0\nDICTIONARY\n5\nC\n100\nAcDbDictionary',
		'0\nENDSEC',
		'0\nEOF',
	].join('\n');
}
