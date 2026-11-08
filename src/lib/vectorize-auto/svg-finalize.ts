import { normalizeSvgForLaser } from './vector/svg-normalize.js';

/** Tinta preta em todo fill/stroke: o motor devolve branco e o vetor abriria invisível. */
export function normalizeInkToBlack(svg: string): string {
	if (!svg) return svg;
	return svg
		.replace(/fill="(?!none|transparent)[^"]*"/gi, 'fill="#000000"')
		.replace(/stroke="(?!none|transparent)[^"]*"/gi, 'stroke="#000000"')
		.replace(/fill:\s*(?!none|transparent)[^;"']+/gi, 'fill:#000000')
		.replace(/stroke:\s*(?!none|transparent)[^;"']+/gi, 'stroke:#000000');
}

/** Dimensões físicas (mm) + margem, mantendo a proporção do viewBox. */
export function postProcessSvg(
	svg: string,
	outputWidth: number,
	outputMargin: number,
): string {
	const vbMatch = svg.match(/viewBox="([^"]+)"/);
	if (!vbMatch) return svg;
	const [vbX, vbY, vbW, vbH] = vbMatch[1].split(/\s+/).map(Number);
	if (!vbW || !vbH) return svg;

	const contentHeight = outputWidth * (vbH / vbW);
	const totalWidth = outputWidth + 2 * outputMargin;
	const totalHeight = contentHeight + 2 * outputMargin;
	const marginVbX = (outputMargin / outputWidth) * vbW;
	const marginVbY = (outputMargin / contentHeight) * vbH;
	const newViewBox = `${vbX - marginVbX} ${vbY - marginVbY} ${vbW + 2 * marginVbX} ${vbH + 2 * marginVbY}`;

	let result = svg;
	result = result.replace(
		/(<svg[^>]*?)(?:\s+width="[^"]*")/i,
		`$1 width="${totalWidth}mm"`,
	);
	result = result.replace(
		/(<svg[^>]*?)(?:\s+height="[^"]*")/i,
		`$1 height="${totalHeight}mm"`,
	);
	result = result.replace(/viewBox="[^"]*"/, `viewBox="${newViewBox}"`);
	if (!result.includes('width="')) {
		result = result.replace('<svg', `<svg width="${totalWidth}mm"`);
	}
	if (!result.includes('height="')) {
		result = result.replace('<svg', `<svg height="${totalHeight}mm"`);
	}
	return result;
}

/**
 * Último passo de TODO resultado, seja qual for o motor: dimensões em mm +
 * normalização para laser (subpaths fechados com `Z`, coordenadas absolutas,
 * sem transform) + tinta preta. Sem o `Z` explícito o EzCad importa os
 * contornos como polilinha aberta e o hatch gera cunhas entre as formas.
 */
export function finalizeSvg(
	svg: string,
	outputWidth: number,
	outputMargin: number,
): string {
	return normalizeInkToBlack(
		normalizeSvgForLaser(postProcessSvg(svg, outputWidth, outputMargin)),
	);
}

function detectInk(svg: string): string {
	const fill = svg.match(/<path[^>]*\bfill="([^"]+)"/i)?.[1]?.trim();
	if (fill && fill !== 'none' && fill !== 'transparent') return fill;
	return '#000000';
}

/**
 * Une todos os <path> num único compound path `evenodd` (sem retângulo de
 * fundo): "um vetor só", com as linhas vazadas do negativo como furos.
 */
export function mergeIntoSingleCompoundPath(input: string): string {
	const svg = normalizeSvgForLaser(input);
	const pathRe = /<path[^>]*?\bd="([^"]+)"[^>]*?(?:\/>|>)/gi;
	const ds: string[] = [];
	for (const m of svg.matchAll(pathRe)) {
		const d = m[1].trim();
		if (d) ds.push(d);
	}
	if (ds.length <= 1) return svg;

	const merged = `<path fill="${detectInk(svg)}" fill-rule="evenodd" d="${ds.join(' ')}"/>`;
	let out = svg
		.replace(/<path\b[^>]*?\/>/gi, '')
		.replace(/<path\b[^>]*?>[\s\S]*?<\/path>/gi, '');
	if (/<\/svg>/i.test(out)) {
		out = out.replace(/<\/svg>/i, `${merged}</svg>`);
	} else {
		out = out.replace(/(<svg[^>]*>)/i, `$1${merged}`);
	}
	return out;
}

/** Paths/nós para as estatísticas (o `Z` de fechamento não conta como nó). */
export function svgStats(svgContent: string) {
	return {
		paths: (svgContent.match(/<path/g) || []).length,
		nodes: (svgContent.match(/[MLCQA]/gi) || []).length,
	};
}
