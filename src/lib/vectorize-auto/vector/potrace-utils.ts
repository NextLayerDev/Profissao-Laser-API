/**
 * Helpers compartilhados do potrace: máscara 1-canal → PNG → trace → `d`.
 * Extraídos de trace-by-color.ts para serem reusados pelo negativo de
 * fotogravação (photo-negative.ts) sem duplicar opções nem semântica.
 *
 * Convenção de máscara (mesma de color-quantize.ts): 1 byte por pixel,
 * 0 = selecionado (preto, o que o potrace traça), 255 = não selecionado.
 */

import potrace from 'potrace';
import sharp from 'sharp';

export const TRACE_OPTS: potrace.PotraceOptions = {
	threshold: 128,
	// blackOnWhite default true → traça o preto (0) da máscara
	turdSize: 2,
	optCurve: true,
	optTolerance: 0.2,
	alphaMax: 1,
};

/** Converte callback do potrace.trace em Promise<string> (SVG). */
export function tracePromise(
	maskPng: Buffer,
	opts: potrace.PotraceOptions,
): Promise<string> {
	return new Promise((resolve, reject) => {
		potrace.trace(maskPng, opts, (err, svg) => {
			if (err) reject(err);
			else resolve(svg);
		});
	});
}

/** Extrai o `d="..."` do primeiro <path> de um SVG do potrace. */
export function extractPathD(svg: string): string {
	const m = svg.match(/<path\b[^>]*\bd="([^"]+)"/i);
	return m ? m[1] : '';
}

/** Gera um PNG grayscale a partir de uma máscara 1-canal (0=preto, 255=branco). */
export async function maskToPng(
	mask: Buffer,
	width: number,
	height: number,
): Promise<Buffer> {
	return sharp(mask, { raw: { width, height, channels: 1 } })
		.png()
		.toBuffer();
}
