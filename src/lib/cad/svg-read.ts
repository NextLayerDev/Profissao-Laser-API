/**
 * Leitor de SVG → `Sketch2D` (a mesma IR do DXF e dos geradores).
 *
 * SEM PARSER XML GENÉRICO, de propósito: parser XML de uso geral resolve
 * entidades externas (XXE) e é um caminho pronto para ler arquivo do servidor
 * via um "desenho" enviado por qualquer aluno. Aqui o arquivo é varrido por
 * TAGS conhecidas, tudo que não é geometria é jogado fora (`script`,
 * `foreignObject`, `image`, `use`, `defs`, DOCTYPE com subset interno) e o SVG
 * de prévia é RE-SERIALIZADO a partir da IR (`render-svg.ts`) — o arquivo do
 * usuário nunca é devolvido ao navegador como veio.
 *
 * Módulo PURO (só `svgpath`, os módulos de `./`, `../tool-errors.js` e built-ins).
 */

import svgpath from 'svgpath';
import { ToolEngineError } from '../tool-errors.js';
import {
	type CadPath,
	EPS,
	type LayerId,
	type Pt,
	rect as rectPath,
	roundRect,
	type Seg,
	type Sketch2D,
	TAU,
} from './ir.js';
import {
	bump,
	type CadReadDiagnostics,
	classifyLayer,
	finalizeSketch,
} from './read-common.js';
import { TESS_EPS, tessCubic, tessEllipse } from './tessellate.js';
import {
	cssLengthToMm,
	hasPhysicalUnit,
	UNIT_TO_MM,
	type UnitName,
	type UnitsResolution,
} from './units.js';
import {
	MAT_ID,
	type Mat,
	matMaxStretch,
	matMul,
	matRotate,
	matScale,
	matTranslate,
	transformSeg,
} from './xform.js';

/** Teto de elementos de geometria lidos — trava contra SVG-bomba. */
export const MAX_ELEMENTOS_SVG = 100_000;

export interface ReadSvgOptions {
	/** Tolerância de corda em mm (default 0,05). */
	eps?: number;
	/** Unidade de 1 unidade-de-usuário, escolhida à mão; manda em tudo. */
	unitHint?: UnitName;
	label?: string;
	maxElements?: number;
}

// ---------------------------------------------------------------------------
// Sniff de conteúdo
// ---------------------------------------------------------------------------

function comoTexto(buf: string | Uint8Array, max: number): string {
	if (typeof buf === 'string') return buf.slice(0, max);
	return Buffer.from(
		buf.buffer,
		buf.byteOffset,
		Math.min(buf.byteLength, max),
	).toString('utf8');
}

/**
 * Descobre o formato pelo CONTEÚDO. O mimetype é ignorado de propósito: o mesmo
 * `.dxf` chega como `application/dxf`, `image/vnd.dxf`, `application/octet-stream`
 * ou `text/plain` conforme o sistema operacional e o navegador do aluno — confiar
 * nele é rejeitar arquivo bom e aceitar arquivo ruim.
 */
export function sniffFormat(buf: string | Uint8Array): 'dxf' | 'svg' | null {
	const head = comoTexto(buf, 4096);
	if (/^\s*0\s*[\r\n]+\s*SECTION/.test(head)) return 'dxf';
	if (head.includes('$ACADVER')) return 'dxf';
	if (/<svg[\s>]/i.test(head.slice(0, 1024))) return 'svg';
	return null;
}

// ---------------------------------------------------------------------------
// Higienização
// ---------------------------------------------------------------------------

/** Blocos removidos INTEIROS (conteúdo incluído) antes de qualquer varredura. */
const BLOCOS_PROIBIDOS = [
	'script',
	'style',
	'foreignObject',
	'text',
	'title',
	'desc',
	'metadata',
	'defs',
	'clipPath',
	'mask',
	'marker',
	'pattern',
	'symbol',
	'filter',
	'animate',
	'animateTransform',
	'animateMotion',
	'set',
];

/** Tags de uma linha removidas (podem trazer recurso externo). */
const TAGS_PROIBIDAS = [
	'script',
	'image',
	'use',
	'foreignObject',
	'animate',
	'animateTransform',
	'animateMotion',
	'set',
	'feImage',
];

function higienizar(
	texto: string,
	descartes: Record<string, number>,
): { limpo: string; textos: number } {
	let s = texto;
	s = s.replace(/<!--[\s\S]*?-->/g, '');
	s = s.replace(/<\?[\s\S]*?\?>/g, '');
	// DOCTYPE com subset interno é o vetor clássico de XXE/billion-laughs. Nada
	// aqui resolve entidade, mas o bloco vai fora de todo jeito.
	s = s.replace(/<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?[^>]*>/gi, (m) => {
		if (/<!ENTITY/i.test(m)) bump(descartes, 'DOCTYPE com <!ENTITY> (XXE)');
		return '';
	});
	s = s.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');

	let textos = 0;
	for (const tag of BLOCOS_PROIBIDOS) {
		const re = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
		s = s.replace(re, () => {
			if (tag === 'text') textos++;
			else if (tag !== 'title' && tag !== 'desc' && tag !== 'metadata')
				bump(descartes, `<${tag}>`);
			return '';
		});
	}
	for (const tag of TAGS_PROIBIDAS) {
		const re = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi');
		s = s.replace(re, () => {
			bump(descartes, `<${tag}>`);
			return '';
		});
	}
	// Sobrou <text> sem fechamento? Conta e remove a tag solta.
	s = s.replace(/<text\b[^>]*>/gi, () => {
		textos++;
		return '';
	});
	// Handler inline (onload/onclick) nunca é executado por nós, mas nem fica no
	// texto que a gente varre.
	s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, () => {
		bump(descartes, 'atributo on*');
		return ' ';
	});
	return { limpo: s, textos };
}

// ---------------------------------------------------------------------------
// Atributos e transform
// ---------------------------------------------------------------------------

const RE_ATTR = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

function lerAtributos(bruto: string): Record<string, string> {
	const out: Record<string, string> = {};
	RE_ATTR.lastIndex = 0;
	let m = RE_ATTR.exec(bruto);
	while (m !== null) {
		out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
		m = RE_ATTR.exec(bruto);
	}
	return out;
}

function nums(raw: string): number[] {
	const out: number[] = [];
	const re = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
	let m = re.exec(raw);
	while (m !== null) {
		const v = Number(m[0]);
		if (Number.isFinite(v)) out.push(v);
		m = re.exec(raw);
	}
	return out;
}

function n(attrs: Record<string, string>, nome: string, def = 0): number {
	const v = attrs[nome];
	if (v === undefined) return def;
	const p = Number.parseFloat(v);
	return Number.isFinite(p) ? p : def;
}

/** Parseia o `transform` do SVG. Esquerda é a transformação MAIS EXTERNA. */
export function parseTransform(raw: string | undefined): Mat {
	if (!raw) return MAT_ID;
	let m = MAT_ID;
	const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
	let g = re.exec(raw);
	while (g !== null) {
		const v = nums(g[2]);
		let f: Mat = MAT_ID;
		switch (g[1]) {
			case 'matrix':
				if (v.length >= 6)
					f = { a: v[0], b: v[1], c: v[2], d: v[3], e: v[4], f: v[5] };
				break;
			case 'translate':
				f = matTranslate(v[0] ?? 0, v[1] ?? 0);
				break;
			case 'scale':
				f = matScale(v[0] ?? 1, v[1] ?? v[0] ?? 1);
				break;
			case 'rotate': {
				const rad = ((v[0] ?? 0) * Math.PI) / 180;
				f =
					v.length >= 3
						? matMul(
								matMul(matTranslate(v[1], v[2]), matRotate(rad)),
								matTranslate(-v[1], -v[2]),
							)
						: matRotate(rad);
				break;
			}
			case 'skewX':
				f = {
					a: 1,
					b: 0,
					c: Math.tan(((v[0] ?? 0) * Math.PI) / 180),
					d: 1,
					e: 0,
					f: 0,
				};
				break;
			case 'skewY':
				f = {
					a: 1,
					b: Math.tan(((v[0] ?? 0) * Math.PI) / 180),
					c: 0,
					d: 1,
					e: 0,
					f: 0,
				};
				break;
		}
		m = matMul(m, f);
		g = re.exec(raw);
	}
	return m;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const CONTAINERS = new Set(['svg', 'g', 'a', 'switch']);
const GEOMETRIA = new Set([
	'path',
	'line',
	'circle',
	'rect',
	'polyline',
	'polygon',
	'ellipse',
]);

const RE_TAG = /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

export function readSvg(text: string, opts?: ReadSvgOptions): Sketch2D {
	if (typeof text !== 'string' || text.trim().length === 0) {
		throw new ToolEngineError(400, 'Arquivo SVG vazio.');
	}
	const epsMm =
		typeof opts?.eps === 'number' && opts.eps > 0 ? opts.eps : TESS_EPS;
	const teto = Math.max(1, opts?.maxElements ?? MAX_ELEMENTOS_SVG);

	const ignoradas: Record<string, number> = {};
	const lidas: Record<string, number> = {};
	const avisos: string[] = [];
	const layersUsadas = new Set<string>();
	const layersAux = new Set<string>();
	const { limpo, textos } = higienizar(text, ignoradas);

	// Cabeçalho: precisa vir antes da geometria porque ε de tesselação é em mm e
	// a geometria é achatada em unidades de usuário.
	const raiz = /<svg\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/i.exec(limpo);
	if (!raiz) {
		throw new ToolEngineError(
			400,
			'Arquivo não parece um SVG (sem tag <svg>).',
		);
	}
	const attrsRaiz = lerAtributos(raiz[1]);
	const unidade = resolverUnidadeSvg(attrsRaiz, opts?.unitHint);
	const s = unidade.factorToMm;
	const epsUsuario = epsMm / (s > 0 ? s : 1);

	const paths: CadPath[] = [];
	let pontos = 0;
	let lidosTotal = 0;

	// Pilha de CTM. O SVG tem Y para BAIXO; a inversão para a IR (Y para cima)
	// entra só no fim, como espelho — assim `transformSeg` corrige de uma vez o
	// sentido dos arcos e o sinal dos bulges.
	const pilha: Array<{ m: Mat; layer: string }> = [{ m: MAT_ID, layer: '' }];
	RE_TAG.lastIndex = 0;
	let t = RE_TAG.exec(limpo);
	while (t !== null) {
		const fechando = t[1] === '/';
		const nome = t[2].replace(/^.*:/, '').toLowerCase();
		const bruto = t[3] ?? '';
		const autoFecha = /\/\s*$/.test(bruto);
		t = RE_TAG.exec(limpo);

		if (fechando) {
			if (CONTAINERS.has(nome) && pilha.length > 1) pilha.pop();
			continue;
		}
		const attrs = lerAtributos(bruto);
		const topo = pilha[pilha.length - 1];
		const ctm = matMul(topo.m, parseTransform(attrs.transform));
		// "Layer" de SVG é `<g inkscape:label="...">` (ou `data-layer`); `id` NÃO
		// serve — é identificador de elemento, não nome de camada.
		const rotulo = attrs['inkscape:label'] ?? attrs['data-layer'] ?? '';
		if (CONTAINERS.has(nome)) {
			if (!autoFecha) pilha.push({ m: ctm, layer: rotulo || topo.layer });
			continue;
		}
		if (!GEOMETRIA.has(nome)) {
			if (nome !== 'tspan' && nome !== 'svg') bump(ignoradas, `<${nome}>`);
			continue;
		}
		if (++lidosTotal > teto) {
			throw new ToolEngineError(
				413,
				`SVG com mais de ${teto} elementos de geometria. Simplifique o arquivo.`,
			);
		}
		const layerNome = rotulo || topo.layer;
		const cls = classifyLayer(layerNome);
		if (cls.aux) layersAux.add(layerNome);
		else if (layerNome) layersUsadas.add(layerNome);

		for (const seg of segsDoElemento(nome, attrs, epsUsuario, avisos)) {
			const k = Math.max(matMaxStretch(ctm), 1e-9);
			const local = transformSeg(seg, ctm, { eps: epsUsuario / k });
			if (local.k === 'poly') pontos += local.pts.length;
			paths.push({ layer: cls.layer, seg: local });
		}
		bump(lidas, nome);
	}

	if (paths.length === 0) {
		throw new ToolEngineError(
			400,
			'Nenhuma geometria utilizável no SVG. Converta textos e imagens em caminhos (path) antes de exportar.',
		);
	}

	// Escala para mm + inversão do eixo Y, de uma vez.
	const escalaFinal: Mat = { a: s, b: 0, c: 0, d: -s, e: 0, f: 0 };
	const finais: CadPath[] = paths.map((p) => ({
		...p,
		seg: transformSeg(p.seg, escalaFinal, { eps: epsUsuario }),
	}));

	const bruta = medirBruto(paths);
	const diag: CadReadDiagnostics = {
		formato: 'svg',
		unidade,
		bboxOriginal: bruta,
		lidas,
		ignoradas,
		textos,
		layersUsadas: [...layersUsadas].sort(),
		layersAuxiliares: [...layersAux].sort(),
		blocosExpandidos: 0,
		blocosCiclicos: [],
		pontosTesselados: pontos,
		epsMm,
	};

	const todos: string[] = [];
	if (unidade.warning) todos.push(unidade.warning);
	if (textos > 0) {
		todos.push(
			`${textos} elemento(s) de texto descartado(s): o SVG precisa ter o texto convertido em caminho (path) para virar corte.`,
		);
	}
	const ign = Object.entries(ignoradas).filter(([, v]) => v > 0);
	if (ign.length > 0) {
		todos.push(
			`Elementos descartados: ${ign.map(([k, v]) => `${k}×${v}`).join(', ')}.`,
		);
	}
	todos.push(...avisos);

	return finalizeSketch({
		paths: finais,
		generator: 'svg-read',
		label: opts?.label ?? 'Arquivo SVG',
		diag,
		warnings: todos,
	});
}

function medirBruto(paths: CadPath[]): { w: number; h: number } {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	const push = (p: Pt): void => {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	};
	for (const c of paths) {
		const sg = c.seg;
		if (sg.k === 'line') {
			push(sg.a);
			push(sg.b);
		} else if (sg.k === 'circle') {
			push({ x: sg.c.x - sg.r, y: sg.c.y - sg.r });
			push({ x: sg.c.x + sg.r, y: sg.c.y + sg.r });
		} else if (sg.k === 'poly') {
			for (const p of sg.pts) push(p);
		} else if (sg.k === 'arc') {
			push({ x: sg.c.x - sg.r, y: sg.c.y - sg.r });
			push({ x: sg.c.x + sg.r, y: sg.c.y + sg.r });
		}
	}
	if (!Number.isFinite(minX)) return { w: 0, h: 0 };
	return { w: maxX - minX, h: maxY - minY };
}

// ---------------------------------------------------------------------------
// Unidade do SVG
// ---------------------------------------------------------------------------

function resolverUnidadeSvg(
	attrs: Record<string, string>,
	hint?: UnitName,
): UnitsResolution {
	if (hint && hint in UNIT_TO_MM) {
		return { factorToMm: UNIT_TO_MM[hint], source: 'hint', detected: hint };
	}
	const vb = nums(attrs.viewbox ?? '');
	const largura = attrs.width;
	const vbW = vb.length >= 4 ? vb[2] : 0;

	if (vbW > EPS) {
		const larguraMm = cssLengthToMm(largura);
		if (larguraMm !== null && larguraMm > 0 && hasPhysicalUnit(largura)) {
			// Caso bom: mm_por_unidade = width_mm / viewBox_w.
			return {
				factorToMm: larguraMm / vbW,
				source: 'svg',
				detected: 'mm',
			};
		}
		if (larguraMm !== null && larguraMm > 0) {
			return {
				factorToMm: larguraMm / vbW,
				source: 'svg',
				detected: 'px',
				warning:
					'SVG com viewBox mas width sem unidade: assumido pixel a 96 dpi. Confirme a escala — 1 px = 0,2646 mm.',
			};
		}
	}
	return {
		factorToMm: UNIT_TO_MM.px,
		source: 'svg',
		detected: 'px',
		warning:
			'SVG sem width/viewBox em unidade física: assumido 96 dpi (1 px = 0,2646 mm). Confirme a escala antes de orçar.',
	};
}

// ---------------------------------------------------------------------------
// Elementos → segmentos da IR (em unidades de usuário, Y para baixo)
// ---------------------------------------------------------------------------

function segsDoElemento(
	nome: string,
	attrs: Record<string, string>,
	epsUsuario: number,
	avisos: string[],
): Seg[] {
	const layer: LayerId = 'CORTE'; // camada real é decidida por quem chama
	switch (nome) {
		case 'line': {
			const a = { x: n(attrs, 'x1'), y: n(attrs, 'y1') };
			const b = { x: n(attrs, 'x2'), y: n(attrs, 'y2') };
			if (Math.hypot(b.x - a.x, b.y - a.y) < EPS) return [];
			return [{ k: 'line', a, b }];
		}
		case 'circle': {
			const r = n(attrs, 'r');
			if (!(r > EPS)) return [];
			return [{ k: 'circle', c: { x: n(attrs, 'cx'), y: n(attrs, 'cy') }, r }];
		}
		case 'ellipse': {
			const rx = n(attrs, 'rx');
			const ry = n(attrs, 'ry');
			if (!(rx > EPS) || !(ry > EPS)) return [];
			const c = { x: n(attrs, 'cx'), y: n(attrs, 'cy') };
			if (Math.abs(rx - ry) < EPS) return [{ k: 'circle', c, r: rx }];
			const pts = tessEllipse(c, rx, ry, 0, 0, TAU, { eps: epsUsuario });
			pts.pop();
			return [{ k: 'poly', pts, closed: true }];
		}
		case 'rect': {
			const w = n(attrs, 'width');
			const h = n(attrs, 'height');
			if (!(w > EPS) || !(h > EPS)) return [];
			const x = n(attrs, 'x');
			const y = n(attrs, 'y');
			const rx = n(attrs, 'rx', -1);
			const ry = n(attrs, 'ry', -1);
			const r = Math.min(rx < 0 ? ry : rx, ry < 0 ? rx : ry);
			if (rx >= 0 && ry >= 0 && Math.abs(rx - ry) > EPS) {
				avisos.push(
					`Retângulo com cantos elípticos (rx=${rx}, ry=${ry}): aproximado por raio ${r}.`,
				);
			}
			return [
				(r > EPS
					? roundRect(x, y, w, h, r, layer)
					: rectPath(x, y, w, h, layer)
				).seg,
			];
		}
		case 'polyline':
		case 'polygon': {
			const v = nums(attrs.points ?? '');
			const pts: Pt[] = [];
			for (let i = 0; i + 1 < v.length; i += 2)
				pts.push({ x: v[i], y: v[i + 1] });
			if (pts.length < 2) return [];
			return [{ k: 'poly', pts, closed: nome === 'polygon' }];
		}
		case 'path':
			return segsDoPath(attrs.d ?? '', epsUsuario, avisos);
		default:
			return [];
	}
}

/**
 * Converte o atributo `d` em polilinhas. `svgpath(d).abs().unarc().unshort()`
 * normaliza arcos elípticos (A) e curvas encurtadas (S/T) em cúbicas; sobra Q,
 * que é elevada à cúbica por fórmula exata (C1 = P0 + 2/3·(Q−P0)).
 * Cada subcaminho (`M`) vira um `poly` próprio — subcaminho é furo ou contorno
 * separado, juntar tudo num traço só inventaria uma linha de corte entre eles.
 */
function segsDoPath(d: string, epsUsuario: number, avisos: string[]): Seg[] {
	if (!d.trim()) return [];
	let norm: ReturnType<typeof svgpath>;
	try {
		norm = svgpath(d).abs().unarc().unshort();
	} catch (e) {
		avisos.push(
			`Caminho SVG ilegível ignorado: ${e instanceof Error ? e.message : String(e)}`,
		);
		return [];
	}
	const out: Seg[] = [];
	let atual: Pt[] = [];
	let fechado = false;
	let cur: Pt = { x: 0, y: 0 };
	let ini: Pt = { x: 0, y: 0 };

	const finaliza = (): void => {
		if (atual.length >= 2) {
			if (fechado && atual.length > 2) {
				const f = atual[0];
				const l = atual[atual.length - 1];
				if (Math.hypot(l.x - f.x, l.y - f.y) < 1e-9) atual.pop();
			}
			out.push({ k: 'poly', pts: atual, closed: fechado });
		}
		atual = [];
		fechado = false;
	};
	const empurra = (p: Pt): void => {
		const l = atual[atual.length - 1];
		if (l && Math.hypot(p.x - l.x, p.y - l.y) < 1e-12) return;
		atual.push(p);
	};

	norm.iterate((seg) => {
		const c = String(seg[0]);
		switch (c) {
			case 'M':
				finaliza();
				cur = { x: Number(seg[1]), y: Number(seg[2]) };
				ini = { ...cur };
				atual.push({ ...cur });
				break;
			case 'L':
				cur = { x: Number(seg[1]), y: Number(seg[2]) };
				empurra({ ...cur });
				break;
			case 'H':
				cur = { x: Number(seg[1]), y: cur.y };
				empurra({ ...cur });
				break;
			case 'V':
				cur = { x: cur.x, y: Number(seg[1]) };
				empurra({ ...cur });
				break;
			case 'C': {
				const p1 = { x: Number(seg[1]), y: Number(seg[2]) };
				const p2 = { x: Number(seg[3]), y: Number(seg[4]) };
				const p3 = { x: Number(seg[5]), y: Number(seg[6]) };
				const pts = tessCubic(cur, p1, p2, p3, { eps: epsUsuario });
				for (let i = 1; i < pts.length; i++) empurra(pts[i]);
				cur = p3;
				break;
			}
			case 'Q': {
				const q = { x: Number(seg[1]), y: Number(seg[2]) };
				const p3 = { x: Number(seg[3]), y: Number(seg[4]) };
				const p1 = {
					x: cur.x + (2 / 3) * (q.x - cur.x),
					y: cur.y + (2 / 3) * (q.y - cur.y),
				};
				const p2 = {
					x: p3.x + (2 / 3) * (q.x - p3.x),
					y: p3.y + (2 / 3) * (q.y - p3.y),
				};
				const pts = tessCubic(cur, p1, p2, p3, { eps: epsUsuario });
				for (let i = 1; i < pts.length; i++) empurra(pts[i]);
				cur = p3;
				break;
			}
			case 'Z':
			case 'z':
				fechado = true;
				finaliza();
				cur = { ...ini };
				atual.push({ ...cur });
				break;
			case 'A':
				// unarc() deveria ter eliminado; se sobrou, liga em reta e avisa.
				cur = { x: Number(seg[6]), y: Number(seg[7]) };
				empurra({ ...cur });
				avisos.push(
					'Arco elíptico não normalizado no path: aproximado por reta.',
				);
				break;
			default:
				break;
		}
	});
	finaliza();
	return out;
}

export type { CadReadDiagnostics };
export { readDiagnostics } from './read-common.js';
