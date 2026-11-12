// ─────────────────────────────────────────────────────────────────────
// Motor de vetorização para laser — porte LOCAL do `/api/vectorize` do
// site_nextlayer (o motor que a Comunidade Laser chama por HTTP). Só os três
// modos que o fluxo Automático usa:
//
//   laser         → silhueta de cor única, Otsu, poucos nós (logo / arte P&B)
//   fotogravacao  → nanquim da IA (rota binária) ou meio-tom com dither (foto)
//   negative      → copo escuro: silhueta sólida + linhas vazadas, 1 compound path
//
// Mesma sequência do handler: análise (`autoParams`) → parâmetros sugeridos do
// Potrace → upscale de qualidade (lanczos até o equivalente a 500 DPI, com
// sharpen contra o serrilhado) → teto de 4000 px → pré-processo do modo →
// Potrace → pós-processo (viewBox, subpaths fechados com Z, limpeza de ruído,
// coordenadas arredondadas).
// ─────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as Potrace from 'potrace';
import sharp from 'sharp';
import {
	FOTOGRAVACAO_MAX_SVG_BYTES,
	type FotogravacaoOptions,
	parseFotogravacaoOptions,
	preprocessFotogravacaoToFile,
	shrinkMaxDimensionForSvgSize,
} from './fotogravacao.js';
import { analyzeImage } from './image-analysis.js';
import { preprocessLaserToFile, roundPathCoords } from './laser.js';
import { preprocessNegativeToFile } from './negative.js';

export type EngineMode = 'laser' | 'fotogravacao' | 'negative';

/** Teto do lado maior depois do upscale (evita timeout do Potrace). */
const MAX_SIDE_AFTER_UPSCALE = 4000;

interface LaserTraceParams {
	threshold: number | null;
	invert: boolean | null;
	despeckle: boolean;
	blur: number | null;
	turdSize: number;
	optTolerance: number;
	alphaMax: number;
	coordPrecision: number;
}

export interface EngineResult {
	svg: string;
	/** Upscale de qualidade aplicado (lado maior de/para), quando houve. */
	upscaled: { from: number; to: number } | null;
}

function trace(
	imagePath: string,
	opts: { turdSize: number; optTolerance: number; alphaMax: number },
): Promise<string> {
	return new Promise((resolve, reject) => {
		Potrace.trace(
			imagePath,
			{
				turdSize: opts.turdSize,
				optTolerance: opts.optTolerance,
				alphaMax: opts.alphaMax,
				optCurve: true,
				color: '#000000',
				background: 'transparent',
				blackOnWhite: true,
			} as Potrace.PotraceOptions,
			(err: Error | null, svg: string) => {
				if (err) return reject(err);
				if (!svg) return reject(new Error('SVG generation failed'));
				resolve(svg);
			},
		);
	});
}

function ensureViewBox(svg: string): string {
	if (/viewBox=/.test(svg)) return svg;
	const widthMatch = svg.match(/width="(\d+(?:\.\d+)?)"/);
	const heightMatch = svg.match(/height="(\d+(?:\.\d+)?)"/);
	if (!widthMatch || !heightMatch) return svg;
	return svg.replace(
		/<svg\b([^>]*?)>/,
		`<svg$1 viewBox="0 0 ${widthMatch[1]} ${heightMatch[1]}">`,
	);
}

/** Todo subpath fechado com Z: sem isso o hatch do EzCad gera cunhas. */
function ensureClosedPaths(svg: string): string {
	return svg.replace(
		/(<path[^>]*\bd=")([^"]+)(")/,
		(_, pre: string, d: string, post: string) => {
			const closed = d.replace(/(M[^M]*?)(?=M|$)/g, (sub: string) =>
				sub.trimEnd().endsWith('Z') ? sub : `${sub} Z`,
			);
			return pre + closed + post;
		},
	);
}

/** Remove subpaths minúsculos (ruído) do `d` do path. */
function cleanSvgSubpaths(svg: string, minArea: number): string {
	const dMatch = svg.match(/<path[^>]*\bd="([^"]+)"/);
	if (!dMatch) return svg;
	const subpaths = dMatch[1].split(/(?=M)/i).filter((s) => s.trim().length > 0);
	if (subpaths.length <= 1) return svg;

	const kept: string[] = [];
	for (const sp of subpaths) {
		const nums = sp.match(/-?\d+(?:\.\d+)?/g);
		if (!nums || nums.length < 4) continue;
		let xMin = Number.POSITIVE_INFINITY;
		let xMax = Number.NEGATIVE_INFINITY;
		let yMin = Number.POSITIVE_INFINITY;
		let yMax = Number.NEGATIVE_INFINITY;
		for (let i = 0; i < nums.length - 1; i += 2) {
			const x = Number.parseFloat(nums[i]);
			const y = Number.parseFloat(nums[i + 1]);
			if (x < xMin) xMin = x;
			if (x > xMax) xMax = x;
			if (y < yMin) yMin = y;
			if (y > yMax) yMax = y;
		}
		if ((xMax - xMin) * (yMax - yMin) >= minArea) kept.push(sp);
	}
	if (kept.length === subpaths.length || kept.length === 0) return svg;
	return svg.replace(dMatch[1], kept.join(' '));
}

/**
 * Vetoriza `input` num dos modos do motor. Equivale a chamar o motor com
 * `autoParams=true` e o `mode` explícito, como faz a Comunidade Laser.
 */
export async function runLaserEngine(
	input: Buffer,
	mode: EngineMode,
): Promise<EngineResult> {
	let buffer = input;
	const meta = await sharp(buffer).metadata();

	// Defaults do motor quando o cliente não manda turdSize/optTolerance/alphaMax.
	const laser: LaserTraceParams = {
		threshold: null,
		invert: null,
		despeckle: false,
		blur: null,
		turdSize: 10,
		optTolerance: 0.8,
		alphaMax: 1.0,
		coordPrecision: 2,
	};
	const fotogravacao: FotogravacaoOptions = parseFotogravacaoOptions({});

	// ─── autoParams: parâmetros sugeridos + upscale de qualidade ───
	const analysis = await analyzeImage(buffer);
	laser.turdSize = analysis.suggestedTurdSize;
	laser.optTolerance = analysis.suggestedOptTolerance;
	laser.alphaMax = analysis.suggestedAlphaMax;

	let upscaled: EngineResult['upscaled'] = null;
	if (analysis.needsQualityUpscale && meta.width && meta.height) {
		buffer = await sharp(buffer)
			.resize(analysis.targetPixels, analysis.targetPixels, {
				fit: 'inside',
				kernel: 'lanczos3',
				withoutEnlargement: false,
			})
			.sharpen({ sigma: 0.8, m1: 0.5, m2: 0.5 })
			.toBuffer();
		upscaled = {
			from: Math.max(meta.width, meta.height),
			to: analysis.targetPixels,
		};
	}

	const postMeta = await sharp(buffer).metadata();
	const postMaxDim = Math.max(postMeta.width || 0, postMeta.height || 0);
	if (
		postMaxDim > MAX_SIDE_AFTER_UPSCALE &&
		postMeta.width &&
		postMeta.height
	) {
		const scale = MAX_SIDE_AFTER_UPSCALE / postMaxDim;
		buffer = await sharp(buffer)
			.resize(
				Math.round(postMeta.width * scale),
				Math.round(postMeta.height * scale),
			)
			.toBuffer();
	}

	const workPath = path.join(os.tmpdir(), `vetor-${crypto.randomUUID()}.png`);
	let svg: string;
	let turdSizeForCleanup = laser.turdSize;
	try {
		if (mode === 'laser') {
			await preprocessLaserToFile(buffer, laser, workPath);
			svg = await trace(workPath, laser);
		} else if (mode === 'negative') {
			await preprocessNegativeToFile(buffer, laser, {}, workPath);
			svg = await trace(workPath, laser);
		} else {
			const fg = fotogravacao;
			const binaryHint = analysis.isAlreadyBinary;
			let prep = await preprocessFotogravacaoToFile(
				buffer,
				fg,
				workPath,
				binaryHint,
			);
			svg = await trace(workPath, fg);

			// Guarda de tamanho: arredonda para inteiro; se ainda estourar e for
			// meio-tom, refaz UMA vez com resolução de trabalho menor.
			const svgBytes = (s: string) =>
				Buffer.byteLength(roundPathCoords(s, fg.coordPrecision));
			let size = svgBytes(svg);
			if (size > FOTOGRAVACAO_MAX_SVG_BYTES && fg.coordPrecision > 0) {
				fg.coordPrecision = 0;
				size = svgBytes(svg);
			}
			const smaller = prep.dithered
				? shrinkMaxDimensionForSvgSize(fg.maxDimension, size)
				: null;
			if (smaller !== null) {
				fg.maxDimension = smaller;
				if (prep.ditherAlgorithm) fg.ditherAlgorithm = prep.ditherAlgorithm;
				prep = await preprocessFotogravacaoToFile(
					buffer,
					fg,
					workPath,
					binaryHint,
				);
				svg = await trace(workPath, fg);
			}
			// O turdSize 5 do pós-processo apagaria os pontos do meio-tom.
			turdSizeForCleanup = fg.turdSize;
		}
	} finally {
		await fs.unlink(workPath).catch(() => {});
	}

	svg = ensureViewBox(svg);
	svg = ensureClosedPaths(svg);
	svg = cleanSvgSubpaths(svg, turdSizeForCleanup * turdSizeForCleanup);
	if (mode === 'laser') svg = roundPathCoords(svg, laser.coordPrecision);
	if (mode === 'fotogravacao') {
		svg = roundPathCoords(svg, fotogravacao.coordPrecision);
	}
	return { svg, upscaled };
}
