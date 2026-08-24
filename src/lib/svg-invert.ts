// ─────────────────────────────────────────────────────────────────────
// INVERSÃO GEOMÉTRICA de um SVG monocromático (não é só cor/fundo).
//
// Gera o COMPLEMENTO: um retângulo do viewBox com TODAS as formas como furos
// (`fill-rule="evenodd"`), num único path. A área marcada realmente troca — o
// Corel/Illustrator/LightBurn e o laser enxergam o negativo. Sem perda: não
// re-rasteriza, não re-traça, não chama IA.
//
// Even-odd deixa isso exatamente correto: fora de tudo cruza 1 borda (preenche),
// dentro de uma forma cruza 2 (furo), dentro do furo de uma forma cruza 3
// (preenche de novo).
//
// Funciona porque o Potrace emite `<path d="..." fill="COR" fill-rule="evenodd"/>`
// — um path só em modo trace, sem <g> e sem <rect> de fundo.
// ─────────────────────────────────────────────────────────────────────

/** Constante de Bézier p/ aproximar 1/4 de círculo com uma cúbica. */
const KAPPA = 0.5522847498307936;

export type InvertReason =
	| 'multicolor'
	| 'transform'
	| 'no_geometry'
	| 'no_viewbox';

export interface SvgGeometry {
	/** viewBox em unidades de usuário. */
	x: number;
	y: number;
	w: number;
	h: number;
	/** `d` de todas as formas preenchíveis, em comandos absolutos. */
	ds: string[];
	/** Cor de tinta detectada. */
	ink: string;
	/** Fills distintos (não-none) encontrados. */
	fills: string[];
	hasTransform: boolean;
}

export type InvertResult = { svg: string } | { error: InvertReason };

/**
 * Remove regiões NÃO renderizáveis antes de colher geometria.
 *
 * Sem isso, um SVG com `linePattern` teria os clip paths duplicados no
 * complemento: `line-patterns.ts` põe `<path d="...">` dentro de `<clipPath>`,
 * e uma regex ingênua os colhe como se fossem arte.
 */
function stripNonRenderable(svg: string): string {
	return svg
		.replace(/<defs\b[\s\S]*?<\/defs>/gi, '')
		.replace(/<clipPath\b[\s\S]*?<\/clipPath>/gi, '')
		.replace(/<pattern\b[\s\S]*?<\/pattern>/gi, '')
		.replace(/<mask\b[\s\S]*?<\/mask>/gi, '')
		.replace(/<symbol\b[\s\S]*?<\/symbol>/gi, '');
}

/** Lê um atributo numérico de uma tag. */
function numAttr(tag: string, name: string, fallback = 0): number {
	const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
	if (!m) return fallback;
	const v = Number.parseFloat(m[1]);
	return Number.isFinite(v) ? v : fallback;
}

function strAttr(tag: string, name: string): string | null {
	const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
	return m ? m[1].trim() : null;
}

function rectToPath(tag: string): string {
	const x = numAttr(tag, 'x');
	const y = numAttr(tag, 'y');
	const w = numAttr(tag, 'width');
	const h = numAttr(tag, 'height');
	if (w <= 0 || h <= 0) return '';

	const rxRaw = numAttr(tag, 'rx', Number.NaN);
	const ryRaw = numAttr(tag, 'ry', Number.NaN);
	let rx = Number.isFinite(rxRaw) ? rxRaw : Number.isFinite(ryRaw) ? ryRaw : 0;
	let ry = Number.isFinite(ryRaw) ? ryRaw : Number.isFinite(rxRaw) ? rxRaw : 0;
	rx = Math.min(Math.max(rx, 0), w / 2);
	ry = Math.min(Math.max(ry, 0), h / 2);

	if (rx === 0 || ry === 0) {
		return `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`;
	}
	const cx = rx * KAPPA;
	const cy = ry * KAPPA;
	return (
		`M${x + rx} ${y}` +
		`L${x + w - rx} ${y}` +
		`C${x + w - rx + cx} ${y} ${x + w} ${y + ry - cy} ${x + w} ${y + ry}` +
		`L${x + w} ${y + h - ry}` +
		`C${x + w} ${y + h - ry + cy} ${x + w - rx + cx} ${y + h} ${x + w - rx} ${y + h}` +
		`L${x + rx} ${y + h}` +
		`C${x + rx - cx} ${y + h} ${x} ${y + h - ry + cy} ${x} ${y + h - ry}` +
		`L${x} ${y + ry}` +
		`C${x} ${y + ry - cy} ${x + rx - cx} ${y} ${x + rx} ${y}` +
		'Z'
	);
}

/**
 * Círculo/elipse → 4 cúbicas de Bézier, NUNCA arcos (`A`). O `parsePathData`
 * do `svgToDxf` não trata `A` e descartaria a forma silenciosamente do DXF.
 */
function ellipseToPath(cx: number, cy: number, rx: number, ry: number): string {
	if (rx <= 0 || ry <= 0) return '';
	const ox = rx * KAPPA;
	const oy = ry * KAPPA;
	return (
		`M${cx + rx} ${cy}` +
		`C${cx + rx} ${cy + oy} ${cx + ox} ${cy + ry} ${cx} ${cy + ry}` +
		`C${cx - ox} ${cy + ry} ${cx - rx} ${cy + oy} ${cx - rx} ${cy}` +
		`C${cx - rx} ${cy - oy} ${cx - ox} ${cy - ry} ${cx} ${cy - ry}` +
		`C${cx + ox} ${cy - ry} ${cx + rx} ${cy - oy} ${cx + rx} ${cy}` +
		'Z'
	);
}

function pointsToPath(tag: string): string {
	const raw = strAttr(tag, 'points');
	if (!raw) return '';
	const nums = raw
		.split(/[\s,]+/)
		.map(Number)
		.filter((n) => Number.isFinite(n));
	if (nums.length < 6) return ''; // menos de 3 pontos não preenche
	let d = `M${nums[0]} ${nums[1]}`;
	for (let i = 2; i + 1 < nums.length; i += 2) {
		d += `L${nums[i]} ${nums[i + 1]}`;
	}
	return `${d}Z`;
}

/** Bounding box aproximada — só o fallback de viewBox ausente. */
function bboxOf(
	ds: string[],
): { x: number; y: number; w: number; h: number } | null {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const d of ds) {
		// Potrace emite só M/L/C/Z absolutos, então pares de números são
		// coordenadas. Aproximação suficiente p/ dimensionar a moldura.
		const nums = (d.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).map(Number);
		for (let i = 0; i + 1 < nums.length; i += 2) {
			const x = nums[i];
			const y = nums[i + 1];
			if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
	}
	if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;
	const mx = (maxX - minX) * 0.01;
	const my = (maxY - minY) * 0.01;
	return {
		x: minX - mx,
		y: minY - my,
		w: maxX - minX + mx * 2,
		h: maxY - minY + my * 2,
	};
}

/**
 * Colhe a geometria preenchível e o viewBox.
 *
 * O viewBox NUNCA é chutado. A cascata é viewBox → width/height sem unidade (ou
 * em px) → bounding box da arte. Isso importa porque `applySvgDimensions`
 * reescreve width/height pra MILÍMETROS deixando o viewBox em pixels — usar
 * width como fonte primária daria uma moldura do tamanho errado.
 */
export function readSvgGeometry(svgRaw: string): SvgGeometry | null {
	const svg = stripNonRenderable(svgRaw);

	const ds: string[] = [];
	const fills = new Set<string>();
	let ink = '#000000';

	const pushFill = (tag: string) => {
		const f = strAttr(tag, 'fill');
		if (f && f !== 'none' && f !== 'transparent') {
			fills.add(f.toLowerCase());
			if (ink === '#000000') ink = f;
		}
	};

	// <path>
	const pathRe = /<path\b[^>]*?(?:\/>|>)/gi;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: iteração padrão de regex global
	while ((m = pathRe.exec(svg)) !== null) {
		const tag = m[0];
		const d = strAttr(tag, 'd');
		if (!d) continue;
		ds.push(d.trim());
		pushFill(tag);
	}

	// Formas básicas — convertidas, não descartadas.
	const shapeRe = /<(rect|polygon|polyline|circle|ellipse)\b[^>]*?(?:\/>|>)/gi;
	// biome-ignore lint/suspicious/noAssignInExpressions: iteração padrão de regex global
	while ((m = shapeRe.exec(svg)) !== null) {
		const tag = m[0];
		const kind = m[1].toLowerCase();
		let d = '';
		if (kind === 'rect') d = rectToPath(tag);
		else if (kind === 'polygon' || kind === 'polyline') d = pointsToPath(tag);
		else if (kind === 'circle') {
			const r = numAttr(tag, 'r');
			d = ellipseToPath(numAttr(tag, 'cx'), numAttr(tag, 'cy'), r, r);
		} else {
			d = ellipseToPath(
				numAttr(tag, 'cx'),
				numAttr(tag, 'cy'),
				numAttr(tag, 'rx'),
				numAttr(tag, 'ry'),
			);
		}
		if (!d) continue;
		ds.push(d);
		pushFill(tag);
	}

	if (ds.length === 0) return null;

	// Transform em qualquer lugar da árvore renderizável.
	const hasTransform =
		/<(?:g|path|rect|polygon|polyline|circle|ellipse)\b[^>]*\btransform\s*=/i.test(
			svg,
		);

	// viewBox
	let box: { x: number; y: number; w: number; h: number } | null = null;
	const vb = svgRaw.match(/viewBox\s*=\s*"([^"]+)"/i);
	if (vb) {
		const p = vb[1].split(/[\s,]+/).map(Number);
		if (
			p.length === 4 &&
			p.every((n) => Number.isFinite(n)) &&
			p[2] > 0 &&
			p[3] > 0
		) {
			box = { x: p[0], y: p[1], w: p[2], h: p[3] };
		}
	}
	if (!box) {
		// width/height só valem SEM unidade ou em px — "100mm" não descreve o
		// sistema de coordenadas dos paths.
		const wRaw = svgRaw.match(/\bwidth\s*=\s*"([^"]+)"/i)?.[1]?.trim();
		const hRaw = svgRaw.match(/\bheight\s*=\s*"([^"]+)"/i)?.[1]?.trim();
		const unitless = (v?: string) =>
			v && /^-?\d*\.?\d+(px)?$/i.test(v) ? Number.parseFloat(v) : Number.NaN;
		const w = unitless(wRaw);
		const h = unitless(hRaw);
		if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
			box = { x: 0, y: 0, w, h };
		}
	}
	if (!box) box = bboxOf(ds);
	if (!box) return null;

	return {
		...box,
		ds,
		ink,
		fills: [...fills],
		hasTransform,
	};
}

/** Remove os elementos de forma originais do SVG. */
function stripShapes(svg: string): string {
	return svg
		.replace(/<path\b[^>]*?\/>/gi, '')
		.replace(/<path\b[^>]*?>[\s\S]*?<\/path>/gi, '')
		.replace(/<(rect|polygon|polyline|circle|ellipse)\b[^>]*?\/>/gi, '')
		.replace(
			/<(rect|polygon|polyline|circle|ellipse)\b[^>]*?>[\s\S]*?<\/\1>/gi,
			'',
		);
}

/**
 * Substitui TODA a geometria renderizável do SVG por um único markup de path
 * (o compound path novo), preservando a tag `<svg>` e seus atributos.
 */
export function injectSoleCompoundPath(
	svgRaw: string,
	pathMarkup: string,
): string {
	let out = stripShapes(stripNonRenderable(svgRaw));
	if (/<\/svg>/i.test(out)) {
		out = out.replace(/<\/svg>/i, `${pathMarkup}</svg>`);
	} else {
		out = out.replace(/(<svg\b[^>]*>)/i, `$1${pathMarkup}`);
	}
	return out;
}

/**
 * Inverte a polaridade: devolve o SVG com um único compound path = moldura do
 * viewBox menos a arte. Recusa (com motivo) quando a inversão geométrica não é
 * confiável — o chamador então roteia pro caminho raster/silhueta.
 */
export function invertSvgPolarity(svgRaw: string): InvertResult {
	const geo = readSvgGeometry(svgRaw);
	if (!geo) return { error: 'no_geometry' };

	// Transformar errado em silêncio é o pior desfecho possível num arquivo de
	// laser — recusa e deixa o caminho raster resolver (ele rasteriza, então
	// lida com transform corretamente).
	if (geo.hasTransform) return { error: 'transform' };

	// Complemento de cor única não faz sentido em multi-cor (modo `color` emite
	// um path por cluster; posterize, um por nível).
	if (geo.fills.length > 1) return { error: 'multicolor' };

	const rectD = `M${geo.x} ${geo.y}H${geo.x + geo.w}V${geo.y + geo.h}H${geo.x}Z`;
	const combined = `${rectD} ${geo.ds.join(' ')}`;
	const invertedPath = `<path fill="${geo.ink}" fill-rule="evenodd" d="${combined}"/>`;

	return { svg: injectSoleCompoundPath(svgRaw, invertedPath) };
}

/**
 * Une TODOS os paths num único compound path com `fill-rule="evenodd"` (SEM a
 * moldura). Garante "um vetor só" e que furos internos sejam interpretados como
 * buracos. Rede de segurança quando a vetorização devolve paths separados.
 */
export function mergeIntoSingleCompoundPath(svgRaw: string): string {
	const geo = readSvgGeometry(svgRaw);
	if (!geo || geo.ds.length <= 1 || geo.hasTransform || geo.fills.length > 1) {
		return svgRaw;
	}
	const merged = `<path fill="${geo.ink}" fill-rule="evenodd" d="${geo.ds.join(' ')}"/>`;
	return injectSoleCompoundPath(svgRaw, merged);
}
