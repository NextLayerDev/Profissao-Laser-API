/**
 * Normaliza um SVG vetorizado para importação em software de laser (EzCad,
 * LightBurn, Corel): todo elemento de desenho vira `<path>` plano com `d`
 * ABSOLUTO (M/L/C), subpaths fechados com `Z` explícito, `transform` achatado
 * nas coordenadas e formas básicas (rect/circle/ellipse/polygon/polyline/line)
 * convertidas em path. Cor/fill-rule/stroke são preservados (herdados do `<g>`).
 *
 * Isomórfico: roda no server (resultado da vetorização, export DXF/PDF) e no
 * browser (inversão de polaridade). Falha segura: qualquer exceção devolve o
 * SVG original — o usuário nunca fica sem resultado.
 *
 * Ver svg-path.ts para o motivo (EzCad trata subpaths sem Z como polilinha
 * aberta e o hatch gera cunhas entre as formas).
 */
import {
	fmt,
	IDENTITY,
	type Matrix,
	multiply,
	parsePathD,
	parseTransform,
	type Subpath,
	serializeSubpaths,
	transformSubpaths,
} from './svg-path.js';

/** Atributos de apresentação herdáveis que importam para o laser. */
interface Paint {
	fill: string;
	fillRule: string | null;
	stroke: string;
	strokeWidth: string | null;
}

interface Frame {
	tag: string;
	matrix: Matrix;
	paint: Paint;
	/** Dentro de defs/clipPath/mask/symbol/marker/pattern nada é desenhado. */
	hidden: boolean;
}

const HIDDEN_CONTAINERS = new Set([
	'defs',
	'clippath',
	'mask',
	'symbol',
	'marker',
	'pattern',
	'lineargradient',
	'radialgradient',
]);
const SHAPES = new Set([
	'path',
	'rect',
	'circle',
	'ellipse',
	'polygon',
	'polyline',
	'line',
]);

const TAG_RE =
	/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttrs(src: string): Record<string, string> {
	const out: Record<string, string> = {};
	let m: RegExpExecArray | null;
	ATTR_RE.lastIndex = 0;
	// biome-ignore lint/suspicious/noAssignInExpressions: laço clássico de RegExp.exec
	while ((m = ATTR_RE.exec(src)) !== null) {
		out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? '').trim();
	}
	// style="fill:…;stroke:…" vence o atributo (mesma precedência do CSS inline).
	if (out.style) {
		for (const decl of out.style.split(';')) {
			const idx = decl.indexOf(':');
			if (idx < 0) continue;
			const k = decl.slice(0, idx).trim().toLowerCase();
			const v = decl.slice(idx + 1).trim();
			if (
				k === 'fill' ||
				k === 'stroke' ||
				k === 'stroke-width' ||
				k === 'fill-rule'
			)
				out[k] = v;
		}
	}
	return out;
}

function inherit(parent: Paint, a: Record<string, string>): Paint {
	const fill =
		a.fill !== undefined && a.fill !== '' && a.fill !== 'inherit'
			? a.fill
			: parent.fill;
	const stroke =
		a.stroke !== undefined && a.stroke !== '' && a.stroke !== 'inherit'
			? a.stroke
			: parent.stroke;
	return {
		fill,
		fillRule: a['fill-rule'] || parent.fillRule,
		stroke,
		strokeWidth: a['stroke-width'] || parent.strokeWidth,
	};
}

const isNone = (v: string) => /^(none|transparent)$/i.test(v.trim());

function num(v: string | undefined, fallback = 0): number {
	const n = parseFloat(v ?? '');
	return Number.isFinite(n) ? n : fallback;
}

/** Elipse em 4 cúbicas (kappa). Fechada. */
function ellipseSubpath(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
): Subpath {
	const k = 0.5522847498307936;
	return {
		x0: cx + rx,
		y0: cy,
		closed: true,
		segs: [
			{
				t: 'C',
				x1: cx + rx,
				y1: cy + ry * k,
				x2: cx + rx * k,
				y2: cy + ry,
				x: cx,
				y: cy + ry,
			},
			{
				t: 'C',
				x1: cx - rx * k,
				y1: cy + ry,
				x2: cx - rx,
				y2: cy + ry * k,
				x: cx - rx,
				y: cy,
			},
			{
				t: 'C',
				x1: cx - rx,
				y1: cy - ry * k,
				x2: cx - rx * k,
				y2: cy - ry,
				x: cx,
				y: cy - ry,
			},
			{
				t: 'C',
				x1: cx + rx * k,
				y1: cy - ry,
				x2: cx + rx,
				y2: cy - ry * k,
				x: cx + rx,
				y: cy,
			},
		],
	};
}

function rectD(a: Record<string, string>): string {
	const x = num(a.x),
		y = num(a.y),
		w = num(a.width),
		h = num(a.height);
	if (w <= 0 || h <= 0) return '';
	let rx = num(a.rx, NaN),
		ry = num(a.ry, NaN);
	if (Number.isNaN(rx) && Number.isNaN(ry)) rx = ry = 0;
	else if (Number.isNaN(rx)) rx = ry;
	else if (Number.isNaN(ry)) ry = rx;
	rx = Math.min(Math.abs(rx), w / 2);
	ry = Math.min(Math.abs(ry), h / 2);
	if (rx === 0 || ry === 0) {
		return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
	}
	return (
		`M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}` +
		`V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
		`H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
		`V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
	);
}

function pointsD(points: string | undefined, close: boolean): string {
	const nums = (points || '')
		.split(/[\s,]+/)
		.filter(Boolean)
		.map(Number)
		.filter(Number.isFinite);
	if (nums.length < 4) return '';
	let d = `M${nums[0]} ${nums[1]}`;
	for (let i = 2; i + 1 < nums.length; i += 2)
		d += `L${nums[i]} ${nums[i + 1]}`;
	return close ? `${d}Z` : d;
}

/** Subpaths de um elemento de forma, já em coordenadas locais (sem transform). */
function shapeSubpaths(tag: string, a: Record<string, string>): Subpath[] {
	switch (tag) {
		case 'path':
			return parsePathD(a.d || '');
		case 'rect':
			return parsePathD(rectD(a));
		case 'circle': {
			const r = num(a.r);
			return r > 0 ? [ellipseSubpath(num(a.cx), num(a.cy), r, r)] : [];
		}
		case 'ellipse': {
			const rx = num(a.rx),
				ry = num(a.ry);
			return rx > 0 && ry > 0
				? [ellipseSubpath(num(a.cx), num(a.cy), rx, ry)]
				: [];
		}
		case 'polygon':
			return parsePathD(pointsD(a.points, true));
		case 'polyline':
			return parsePathD(pointsD(a.points, false));
		case 'line':
			return parsePathD(`M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`);
		default:
			return [];
	}
}

function escapeAttr(v: string): string {
	return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** stroke-width escalado pela raiz do determinante do transform achatado. */
function scaledStrokeWidth(sw: string | null, m: Matrix): string | null {
	if (!sw) return null;
	const n = parseFloat(sw);
	if (!Number.isFinite(n)) return sw;
	const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
	const s = det > 0 ? Math.sqrt(det) : 1;
	return fmt(n * s);
}

export interface NormalizedSvg {
	svg: string;
	/** Quantos `<path>` saíram (0 = nada desenhável encontrado). */
	paths: number;
}

/**
 * Normaliza o SVG (ver cabeçalho). Preserva a tag raiz `<svg …>` como está —
 * width/height/viewBox continuam sendo tratados por `postProcessSvg`.
 * Lança se o documento não tiver `<svg>`; use `normalizeSvgForLaser` para a
 * versão à prova de falha.
 */
export function normalizeSvgDocument(src: string): NormalizedSvg {
	const rootMatch = src.match(/<svg\b(?:"[^"]*"|'[^']*'|[^'">])*>/i);
	if (!rootMatch || rootMatch.index === undefined)
		throw new Error('SVG sem tag <svg>');
	const rootTag = rootMatch[0];
	const rootAttrs = parseAttrs(rootTag.slice(4, -1));

	const rootPaint: Paint = inherit(
		{ fill: '#000000', fillRule: null, stroke: 'none', strokeWidth: null },
		rootAttrs,
	);
	const stack: Frame[] = [
		{ tag: 'svg', matrix: IDENTITY, paint: rootPaint, hidden: false },
	];
	const out: string[] = [];

	const body = src.slice(rootMatch.index + rootTag.length);
	TAG_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: laço clássico de RegExp.exec
	while ((m = TAG_RE.exec(body)) !== null) {
		const raw = m[0];
		const name = m[1];
		if (!name) continue; // comentário, CDATA, PI, doctype
		const tag = name.toLowerCase();
		const parent = stack[stack.length - 1];

		if (raw.startsWith('</')) {
			if (tag === 'svg' && stack.length === 1) break; // fim da raiz
			if (stack.length > 1 && parent.tag === tag) stack.pop();
			continue;
		}

		const selfClosing = /\/\s*>$/.test(raw);
		const attrs = parseAttrs(m[2] || '');
		const frame: Frame = {
			tag,
			matrix: multiply(parent.matrix, parseTransform(attrs.transform)),
			paint: inherit(parent.paint, attrs),
			hidden: parent.hidden || HIDDEN_CONTAINERS.has(tag),
		};

		if (SHAPES.has(tag) && !frame.hidden && attrs.display !== 'none') {
			const subs = transformSubpaths(shapeSubpaths(tag, attrs), frame.matrix);
			const filled = !isNone(frame.paint.fill);
			const d = serializeSubpaths(subs, { filled });
			if (d) {
				let el = `<path fill="${escapeAttr(frame.paint.fill)}"`;
				if (filled && frame.paint.fillRule)
					el += ` fill-rule="${escapeAttr(frame.paint.fillRule)}"`;
				if (!isNone(frame.paint.stroke)) {
					el += ` stroke="${escapeAttr(frame.paint.stroke)}"`;
					const sw = scaledStrokeWidth(frame.paint.strokeWidth, frame.matrix);
					if (sw) el += ` stroke-width="${escapeAttr(sw)}"`;
				}
				el += ` d="${d}"/>`;
				out.push(el);
			}
		}

		if (!selfClosing) stack.push(frame);
	}

	return {
		svg: `${rootTag}\n${out.join('\n')}\n</svg>`,
		paths: out.length,
	};
}

/**
 * Versão à prova de falha de `normalizeSvgDocument`: em qualquer erro, ou se a
 * normalização perder todos os paths de um SVG que tinha desenho, devolve o
 * original intacto.
 */
export function normalizeSvgForLaser(svg: string): string {
	if (!svg || !/<svg\b/i.test(svg)) return svg;
	try {
		const res = normalizeSvgDocument(svg);
		const hadDrawing =
			/<(path|rect|circle|ellipse|polygon|polyline|line)\b/i.test(svg);
		if (hadDrawing && res.paths === 0) return svg;
		return res.svg;
	} catch (err) {
		console.error('[svg-normalize] mantendo SVG original:', err);
		return svg;
	}
}
