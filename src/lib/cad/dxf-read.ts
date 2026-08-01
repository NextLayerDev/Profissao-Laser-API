/**
 * Leitor de DXF → `Sketch2D`. A MESMA IR que os geradores produzem, então SVG de
 * prévia, métricas e nesting funcionam de graça no arquivo do cliente.
 *
 * DXF de campo é SUJO: vem sem `$INSUNITS`, com bloco dentro de bloco, com
 * arranjo retangular de nesting, com hachura, cota e texto misturados no mesmo
 * layer, com escala negativa (espelho) e escala não-uniforme. Cada um desses
 * casos aqui tem tratamento explícito e CONTAGEM — o que o leitor não entendeu
 * aparece no diagnóstico, nunca desaparece silenciosamente dentro de um preço.
 *
 * Módulo PURO (só `dxf-parser`, `./ir.js`, `./tessellate.js`, `./units.js`,
 * `./xform.js`, `./read-common.js`, `../tool-errors.js` e built-ins).
 */

import DxfParser from 'dxf-parser';
import { ToolEngineError } from '../tool-errors.js';
import {
	bboxOf,
	type CadPath,
	EPS,
	type Pt,
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
import { TESS_EPS, tessEllipse, tessSpline } from './tessellate.js';
import { resolveUnits, type UnitName } from './units.js';
import {
	MAT_ID,
	type Mat,
	matMaxStretch,
	matMul,
	matRotate,
	matScale,
	matTranslate,
	scaleSeg,
	transformSeg,
} from './xform.js';

// ---------------------------------------------------------------------------
// Limites de segurança
// ---------------------------------------------------------------------------

/** Teto de entidades expandidas. Acima disso é bomba de expansão, não orçamento. */
export const MAX_ENTIDADES = 100_000;

/** Profundidade máxima de bloco dentro de bloco. */
export const MAX_PROF_BLOCO = 16;

export interface ReadDxfOptions {
	/** Tolerância de corda em mm (default 0,05). */
	eps?: number;
	/** Unidade escolhida à mão pelo profissional; manda no `$INSUNITS`. */
	unitHint?: UnitName;
	/** Teto de entidades expandidas (default `MAX_ENTIDADES`). */
	maxEntities?: number;
	/** Rótulo da peça resultante. */
	label?: string;
}

/**
 * Tipos que o `dxf-parser` NÃO tem handler para (e portanto descarta antes de
 * chegarmos): contamos direto no texto para o profissional saber que o arquivo
 * tinha hachura/liderança e que isso não virou corte.
 */
const IGNORADAS_NO_TEXTO = [
	'HATCH',
	'LEADER',
	'MLEADER',
	'MULTILEADER',
	'MLINE',
	'REGION',
	'3DSOLID',
	'BODY',
	'MESH',
	'SURFACE',
	'IMAGE',
	'WIPEOUT',
	'TOLERANCE',
	'XLINE',
	'RAY',
	'TRACE',
	'ACAD_TABLE',
	'ACAD_PROXY_ENTITY',
	'OLE2FRAME',
];

/** Tipos que o parser entrega mas que não são geometria de corte. */
const IGNORADAS_PARSEADAS = new Set([
	'SOLID',
	'3DFACE',
	'DIMENSION',
	'POINT',
	'ATTDEF',
	'ATTRIB',
	'VIEWPORT',
]);

// ---------------------------------------------------------------------------
// Tipos frouxos: o DXF real traz campo faltando em qualquer lugar
// ---------------------------------------------------------------------------

interface EntidadeCrua {
	type?: string;
	layer?: string;
	visible?: boolean;
	vertices?: Array<{ x?: number; y?: number; bulge?: number }>;
	center?: { x?: number; y?: number };
	radius?: number;
	startAngle?: number;
	endAngle?: number;
	shape?: boolean;
	closed?: boolean;
	majorAxisEndPoint?: { x?: number; y?: number };
	axisRatio?: number;
	controlPoints?: Array<{ x?: number; y?: number }>;
	fitPoints?: Array<{ x?: number; y?: number }>;
	knotValues?: number[];
	weights?: number[];
	degreeOfSplineCurve?: number;
	name?: string;
	position?: { x?: number; y?: number };
	rotation?: number;
	xScale?: number;
	yScale?: number;
	columnCount?: number;
	rowCount?: number;
	columnSpacing?: number;
	rowSpacing?: number;
	startPoint?: { x?: number; y?: number };
	textHeight?: number;
	height?: number;
	text?: string;
	halign?: number;
}

interface BlocoCru {
	name?: string;
	position?: { x?: number; y?: number };
	entities?: EntidadeCrua[];
}

interface DxfCru {
	header?: Record<string, unknown>;
	entities?: EntidadeCrua[];
	blocks?: Record<string, BlocoCru>;
	tables?: {
		layer?: {
			layers?: Record<
				string,
				{ frozen?: boolean; visible?: boolean; colorIndex?: number }
			>;
		};
	};
}

function num(v: unknown, def = 0): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : def;
}

function pt(p: { x?: number; y?: number } | undefined): Pt {
	return { x: num(p?.x), y: num(p?.y) };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

interface Passada {
	paths: CadPath[];
	lidas: Record<string, number>;
	ignoradas: Record<string, number>;
	textos: number;
	layersUsadas: Set<string>;
	layersAux: Set<string>;
	blocos: number;
	ciclos: Set<string>;
	pontos: number;
	avisos: Set<string>;
}

export function readDxf(text: string, opts?: ReadDxfOptions): Sketch2D {
	if (typeof text !== 'string' || text.trim().length === 0) {
		throw new ToolEngineError(400, 'Arquivo DXF vazio.');
	}
	const epsMm =
		typeof opts?.eps === 'number' && opts.eps > 0 ? opts.eps : TESS_EPS;
	const teto = Math.max(1, opts?.maxEntities ?? MAX_ENTIDADES);

	let dxf: DxfCru | null;
	try {
		dxf = new DxfParser().parseSync(text) as unknown as DxfCru | null;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new ToolEngineError(400, `DXF ilegível: ${msg}`);
	}
	if (!dxf || !Array.isArray(dxf.entities)) {
		throw new ToolEngineError(
			400,
			'DXF sem seção ENTITIES legível. Reexporte do seu CAD em DXF R2000 ou posterior.',
		);
	}

	// 1ª passada com ε em unidades de arquivo assumindo mm — o suficiente para a
	// bbox que a heurística de unidade precisa.
	let p1 = varrer(dxf, epsMm, teto);
	const bruta = bboxOf(p1.paths);
	const insunits = dxf.header?.$INSUNITS;
	const unidade = resolveUnits({
		insunits: typeof insunits === 'number' ? insunits : null,
		bbox: { w: bruta.w, h: bruta.h },
		hint: opts?.unitHint ?? null,
	});

	// 2ª passada quando a unidade não é mm: ε precisa valer 0,05 mm DEPOIS da
	// conversão, senão um arquivo em polegada sairia 25× mais facetado.
	if (Math.abs(unidade.factorToMm - 1) > 1e-12) {
		p1 = varrer(dxf, epsMm / unidade.factorToMm, teto);
	}

	const paths =
		Math.abs(unidade.factorToMm - 1) < 1e-12
			? p1.paths
			: p1.paths.map((c) => ({
					...c,
					seg: scaleSeg(c.seg, unidade.factorToMm),
				}));

	if (paths.length === 0) {
		throw new ToolEngineError(
			400,
			'Nenhuma geometria utilizável no DXF (só texto, cota ou hachura). Exporte o contorno como linha, arco, polilinha ou spline.',
		);
	}

	for (const t of IGNORADAS_NO_TEXTO) {
		const n = contarNoTexto(text, t);
		if (n > 0) bump(p1.ignoradas, t, n);
	}

	const diag: CadReadDiagnostics = {
		formato: 'dxf',
		unidade,
		bboxOriginal: { w: bruta.w, h: bruta.h },
		lidas: p1.lidas,
		ignoradas: p1.ignoradas,
		textos: p1.textos,
		layersUsadas: [...p1.layersUsadas].sort(),
		layersAuxiliares: [...p1.layersAux].sort(),
		blocosExpandidos: p1.blocos,
		blocosCiclicos: [...p1.ciclos].sort(),
		pontosTesselados: p1.pontos,
		epsMm,
	};

	return finalizeSketch({
		paths,
		generator: 'dxf-read',
		label: opts?.label ?? 'Arquivo DXF',
		diag,
		warnings: montarAvisos(diag, p1.avisos),
	});
}

function montarAvisos(diag: CadReadDiagnostics, extras: Set<string>): string[] {
	const out: string[] = [];
	if (diag.unidade.warning) out.push(diag.unidade.warning);
	if (diag.textos > 0) {
		out.push(
			`${diag.textos} texto(s) não vetorizado(s): o laser não corta texto de CAD sem converter em curva, então eles NÃO entram no comprimento de corte.`,
		);
	}
	const ign = Object.entries(diag.ignoradas).filter(([, n]) => n > 0);
	if (ign.length > 0) {
		out.push(
			`Entidades ignoradas (não viram corte): ${ign.map(([k, n]) => `${k}×${n}`).join(', ')}.`,
		);
	}
	if (diag.layersAuxiliares.length > 0) {
		out.push(
			`Layers auxiliares fora do corte: ${diag.layersAuxiliares.join(', ')}.`,
		);
	}
	if (diag.blocosCiclicos.length > 0) {
		out.push(
			`Bloco(s) com referência circular cortados na leitura: ${diag.blocosCiclicos.join(', ')}. O arquivo está malformado.`,
		);
	}
	for (const e of extras) out.push(e);
	return out;
}

/** Conta ocorrências do par (0, TIPO) no texto cru do DXF. */
function contarNoTexto(text: string, tipo: string): number {
	const re = new RegExp(
		`(^|[\\r\\n])\\s*0\\s*[\\r\\n]+\\s*${tipo}\\s*(?=[\\r\\n]|$)`,
		'g',
	);
	let n = 0;
	while (re.exec(text) !== null) n++;
	return n;
}

// ---------------------------------------------------------------------------
// Varredura das entidades (com expansão de INSERT)
// ---------------------------------------------------------------------------

function varrer(dxf: DxfCru, epsArquivo: number, teto: number): Passada {
	const st: Passada = {
		paths: [],
		lidas: {},
		ignoradas: {},
		textos: 0,
		layersUsadas: new Set(),
		layersAux: new Set(),
		blocos: 0,
		ciclos: new Set(),
		pontos: 0,
		avisos: new Set(),
	};
	const camadas = dxf.tables?.layer?.layers ?? {};
	let expandidas = 0;

	const layerOculta = (nome: string): boolean => {
		const l = camadas[nome];
		if (!l) return false;
		return l.frozen === true || l.visible === false;
	};

	const empurrar = (
		layerNome: string,
		seg: Seg,
		m: Mat,
		tipo: string,
	): void => {
		const cls = classifyLayer(layerNome);
		if (cls.aux) st.layersAux.add(layerNome || '0');
		else st.layersUsadas.add(layerNome || '0');
		// ε é medido nas coordenadas de ORIGEM do segmento: bloco ampliado 10×
		// precisa de ε 10× menor para a peça final ficar dentro da tolerância.
		const k = Math.max(matMaxStretch(m), 1e-9);
		const final = transformSeg(seg, m, { eps: epsArquivo / k });
		if (final.k === 'poly') st.pontos += final.pts.length;
		st.paths.push({ layer: cls.layer, seg: final });
		bump(st.lidas, tipo);
	};

	const visitar = (
		ents: EntidadeCrua[],
		m: Mat,
		prof: number,
		pilha: Set<string>,
	): void => {
		for (const e of ents) {
			expandidas++;
			if (expandidas > teto) {
				throw new ToolEngineError(
					413,
					`Arquivo expande para mais de ${teto} entidades. Simplifique o DXF (menos repetições de bloco) e tente de novo.`,
				);
			}
			const tipo = (e.type ?? '?').toUpperCase();
			const layer = e.layer ?? '0';
			if (e.visible === false || layerOculta(layer)) {
				bump(st.ignoradas, `${tipo} (invisível)`);
				continue;
			}
			if (IGNORADAS_PARSEADAS.has(tipo)) {
				bump(st.ignoradas, tipo);
				continue;
			}
			switch (tipo) {
				case 'LINE': {
					const v = e.vertices ?? [];
					if (v.length < 2) break;
					empurrar(layer, { k: 'line', a: pt(v[0]), b: pt(v[1]) }, m, tipo);
					break;
				}
				case 'LWPOLYLINE':
				case 'POLYLINE': {
					const v = e.vertices ?? [];
					if (v.length < 2) break;
					const pts = v.map(pt);
					const bulges = v.map((x) => num(x.bulge));
					const fechada = e.shape === true || e.closed === true;
					const temBulge = bulges.some((b) => Math.abs(b) > EPS);
					empurrar(
						layer,
						{
							k: 'poly',
							pts,
							closed: fechada,
							...(temBulge ? { bulges } : {}),
						},
						m,
						tipo,
					);
					break;
				}
				case 'CIRCLE': {
					const r = num(e.radius);
					if (!(r > EPS)) break;
					empurrar(layer, { k: 'circle', c: pt(e.center), r }, m, tipo);
					break;
				}
				case 'ARC': {
					const r = num(e.radius);
					if (!(r > EPS)) break;
					// dxf-parser já entrega startAngle/endAngle em RADIANOS.
					const a0 = num(e.startAngle);
					const a1 = num(e.endAngle);
					// Start ≡ end é a VOLTA COMPLETA, e vários CAMs escrevem círculo
					// assim (0→360). Como `arcSweep` devolve 0 nesse caso — por
					// contrato, para que arco de varredura nula não vire volta —, o
					// contorno sairia com comprimento ZERO: sumia do corte e da prévia,
					// mas continuava contando uma perfuração. Um Ø100 assim tirava
					// 314 mm do orçamento em silêncio. A ELLIPSE já tratava isto logo
					// abaixo; o ARC era o buraco.
					if (
						Math.abs(a1 - a0) < EPS ||
						Math.abs(Math.abs(a1 - a0) - TAU) < 1e-9
					) {
						empurrar(layer, { k: 'circle', c: pt(e.center), r }, m, tipo);
						break;
					}
					// ARC no DXF é sempre anti-horário de start para end.
					empurrar(
						layer,
						{ k: 'arc', c: pt(e.center), r, a0, a1, ccw: true },
						m,
						tipo,
					);
					break;
				}
				case 'ELLIPSE': {
					const c = pt(e.center);
					const eixo = pt(e.majorAxisEndPoint);
					const a = Math.hypot(eixo.x, eixo.y);
					const ratio = num(e.axisRatio, 1);
					if (!(a > EPS)) break;
					const b = a * (ratio > 0 ? ratio : 1);
					const rot = Math.atan2(eixo.y, eixo.x);
					const t0 = num(e.startAngle);
					// Elipse completa vem como 0..2π; parcial precisa do sentido positivo.
					let t1 = num(e.endAngle, TAU);
					if (t1 <= t0 + EPS) t1 = t0 + TAU;
					const cheia = Math.abs(t1 - t0 - TAU) < 1e-6;
					const pts = tessEllipse(c, a, b, rot, t0, cheia ? t0 + TAU : t1, {
						eps: epsArquivo,
					});
					if (cheia) pts.pop(); // fechada: não repete o 1º ponto
					empurrar(layer, { k: 'poly', pts, closed: cheia }, m, tipo);
					break;
				}
				case 'SPLINE': {
					const cps = (e.controlPoints ?? []).map(pt);
					const fit = (e.fitPoints ?? []).map(pt);
					if (cps.length >= 2) {
						const pts = tessSpline(
							{
								controlPoints: cps,
								degree: num(e.degreeOfSplineCurve, 3),
								knots: e.knotValues,
								weights: e.weights,
								closed: e.closed === true,
							},
							{ eps: epsArquivo },
						);
						if (pts.length < 2) break;
						empurrar(
							layer,
							{ k: 'poly', pts, closed: e.closed === true },
							m,
							tipo,
						);
					} else if (fit.length >= 2) {
						// Só pontos de ajuste: liga em polilinha e AVISA — sem os pontos de
						// controle não há como reconstruir a curva original.
						st.avisos.add(
							'SPLINE sem pontos de controle: aproximada pela poligonal dos pontos de ajuste (comprimento pode sair alguns décimos menor).',
						);
						empurrar(
							layer,
							{ k: 'poly', pts: fit, closed: e.closed === true },
							m,
							tipo,
						);
					}
					break;
				}
				case 'TEXT':
				case 'MTEXT': {
					const at = pt(e.startPoint ?? e.position);
					const h = num(e.textHeight ?? e.height, 2.5);
					const conteudo = String(e.text ?? '').slice(0, 200);
					st.textos++;
					// Vai para o desenho como REFERENCIA (nunca soma corte) — a decisão
					// de vetorizar texto é do profissional, não do leitor.
					st.paths.push({
						layer: 'REFERENCIA',
						seg: transformSeg(
							{
								k: 'text',
								at,
								text: conteudo,
								h,
								rot: num(e.rotation),
								anchor: e.halign === 1 ? 'c' : e.halign === 2 ? 'r' : 'l',
							},
							m,
							{ eps: epsArquivo },
						),
					});
					bump(st.lidas, tipo);
					break;
				}
				case 'INSERT': {
					const nome = String(e.name ?? '');
					const bloco = dxf.blocks?.[nome];
					if (!bloco || !Array.isArray(bloco.entities)) {
						bump(st.ignoradas, 'INSERT (bloco ausente)');
						break;
					}
					if (pilha.has(nome)) {
						// A→B→A: sem isto a recursão nunca volta e o servidor trava.
						st.ciclos.add(nome);
						break;
					}
					if (prof >= MAX_PROF_BLOCO) {
						st.avisos.add(
							`Bloco "${nome}" além de ${MAX_PROF_BLOCO} níveis de aninhamento: conteúdo mais profundo ignorado.`,
						);
						break;
					}
					const base = pt(bloco.position);
					const sx = num(e.xScale, 1) || 1;
					const sy = num(e.yScale, 1) || 1;
					const rot = (num(e.rotation) * Math.PI) / 180;
					const cols = Math.max(1, Math.round(num(e.columnCount, 1)));
					const rows = Math.max(1, Math.round(num(e.rowCount, 1)));
					const cs = num(e.columnSpacing);
					const rs = num(e.rowSpacing);
					const proxPilha = new Set(pilha);
					proxPilha.add(nome);
					const pos = pt(e.position);
					for (let ci = 0; ci < cols; ci++) {
						for (let ri = 0; ri < rows; ri++) {
							// M = T(insert)·R(rot)·T(arranjo)·S(sx,sy)·T(−base). O arranjo
							// entra DEPOIS da escala e ANTES da rotação: o espaçamento é em
							// unidades de desenho e acompanha a rotação do INSERT.
							const local = matMul(
								matMul(
									matMul(matTranslate(pos.x, pos.y), matRotate(rot)),
									matTranslate(ci * cs, ri * rs),
								),
								matMul(matScale(sx, sy), matTranslate(-base.x, -base.y)),
							);
							st.blocos++;
							visitar(bloco.entities, matMul(m, local), prof + 1, proxPilha);
						}
					}
					break;
				}
				default:
					bump(st.ignoradas, tipo);
					break;
			}
		}
	};

	visitar(dxf.entities ?? [], MAT_ID, 0, new Set());
	return st;
}

// ---------------------------------------------------------------------------
// Reexports úteis a quem consome o leitor
// ---------------------------------------------------------------------------

export type { CadReadDiagnostics };
export { readDiagnostics } from './read-common.js';
