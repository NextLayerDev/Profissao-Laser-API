import * as Potrace from 'potrace';
import sharp from 'sharp';
import type { VectorizeParams } from '../types/vector.js';
import { applyDithering } from './dithering.js';
import { applyLinePattern } from './line-patterns.js';

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
	const blur = fields.blur ? clamp(parseFloat(fields.blur), 0.3, 20) : null;
	const sharpen = fields.sharpen === 'true';
	const brightness = fields.brightness
		? clamp(parseFloat(fields.brightness), 0.1, 3.0)
		: null;
	const contrast = fields.contrast
		? clamp(parseFloat(fields.contrast), 0.1, 3.0)
		: null;
	const gamma = fields.gamma ? clamp(parseFloat(fields.gamma), 1.0, 3.0) : null;

	const turnPolicy = pickOrNull(fields.turnPolicy, [
		'black',
		'white',
		'left',
		'right',
		'minority',
		'majority',
	] as const);
	const blackOnWhite = fields.blackOnWhite !== 'false';

	const mode = fields.mode === 'posterize' ? 'posterize' : 'trace';
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
	const lineAngle = fields.lineAngle
		? clamp(parseFloat(fields.lineAngle), 0, 360)
		: null;

	const dpi = fields.dpi ? clamp(parseInt(fields.dpi, 10), 72, 360) : null;
	const outputWidth = fields.outputWidth
		? parseFloat(fields.outputWidth)
		: null;
	const outputHeight = fields.outputHeight
		? parseFloat(fields.outputHeight)
		: null;
	const svgOptimize = fields.svgOptimize === 'true';

	const edgeDetection = pick(
		fields.edgeDetection,
		['none', 'sobel', 'canny'] as const,
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
		edgeDetection,
	};
}

// ─── Pré-processamento (sharp) → Buffer PNG (sem arquivos temporários) ──

async function preprocessImage(
	buffer: Buffer,
	params: VectorizeParams,
): Promise<Buffer> {
	// Posterize: preserva cores para o Potrace.posterize()
	if (params.mode === 'posterize') {
		let pipeline = sharp(buffer);
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
		return sharp(buffer).threshold(128).png().toBuffer();
	}

	let pipeline = sharp(buffer).grayscale();

	if (params.brightness !== null) {
		pipeline = pipeline.modulate({ brightness: params.brightness });
	}

	if (params.contrast !== null) {
		pipeline = pipeline.normalize();
		const gammaValue = 1 / params.contrast;
		pipeline = pipeline.gamma(clamp(gammaValue, 1.0, 3.0));
	}

	if (params.gamma !== null && params.contrast === null) {
		pipeline = pipeline.gamma(params.gamma);
	}

	if (params.blur !== null) {
		pipeline = pipeline.blur(params.blur);
	}

	if (params.sharpen) {
		pipeline = pipeline.sharpen();
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

function postProcessSvg(svg: string, params: VectorizeParams): string {
	let result = svg;

	// 1. Stroke styles
	if (params.drawingStyle === 'stroke' || params.drawingStyle === 'outline') {
		const strokeAttributes = `stroke="${params.color}" stroke-width="${params.strokeWidth}"${params.nonScalingStroke ? ' vector-effect="non-scaling-stroke"' : ''}`;
		if (params.mode === 'posterize') {
			result = result.replace(
				/<path/g,
				`<path fill="none" ${strokeAttributes}`,
			);
		} else {
			result = result.replace('<path', `<path fill="none" ${strokeAttributes}`);
		}
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

	// 4. Otimização do SVG
	if (params.svgOptimize) {
		result = simplifySvgPaths(result);
	}

	return result;
}

// ─── API pública do motor ────────────────────────────────────────────

/**
 * Pré-processa, vetoriza (trace/posterize) e pós-processa, devolvendo o SVG.
 * Opera totalmente em memória (Buffer), sem arquivos temporários.
 */
export async function vectorizeImage(
	buffer: Buffer,
	params: VectorizeParams,
): Promise<string> {
	const processed = await preprocessImage(buffer, params);
	const svg =
		params.mode === 'posterize'
			? await posterizeImage(processed, params)
			: await traceImage(processed, params);
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
