/**
 * Topologia e métricas de um `Sketch2D` — a ponte entre "o arquivo do cliente" e
 * "o preço".
 *
 * O trabalho pesado aqui é o ENCADEAMENTO. DXF de campo praticamente nunca traz
 * o contorno como uma polilinha: traz o retângulo picado em 4 `LINE` soltas, o
 * canto arredondado em `LINE`+`ARC`+`LINE`. Sem juntar isso, uma peça com furo
 * é lida como "5 contornos abertos": não há peça, não há furo, não há área
 * líquida — e o orçamento sai errado com cara de certo.
 *
 * Duas garantias que valem dinheiro:
 * - **comprimento exato**: o comprimento sai de `segLength` na forma canônica
 *   (arco é arco, círculo é círculo), nunca da polilinha achatada;
 * - **área exata**: shoelace nos vértices canônicos MAIS a correção de segmento
 *   circular `(θ − sen θ)·r²/2` de cada arco/bulge. Um furo R=5 dá π·25 no ponto,
 *   não 99,87% disso como daria o polígono inscrito.
 *
 * A IA não entra em nenhuma linha deste arquivo: tudo aqui é conta fechada e
 * testável. Um LLM que soma áreas produz orçamento errado com aparência de
 * certo — o pior modo de falha possível nesta ferramenta.
 *
 * Nomes: os campos de `CadMetrics` estão em snake_case porque são o CONTRATO que
 * a camada de precificação lê (`comprimento_corte_mm`, `area_liquida_mm2`...);
 * o resto do módulo segue o camelCase PT-BR do restante do motor CAD.
 *
 * Módulo PURO: `./ir.js`, `./tessellate.js`, `./xform.js`, `./read-common.js`,
 * `../tool-errors.js` e built-ins. Nada que leia env no topo.
 */

import { ToolEngineError } from '../tool-errors.js';
import {
	arcFromBulge,
	arcSweep,
	type BBox,
	bboxOf,
	type CadPath,
	EPS,
	type LayerId,
	type Pt,
	type Seg,
	type Sketch2D,
	segLength,
	sweepFromBulge,
	TAU,
} from './ir.js';
import { readDiagnostics } from './read-common.js';
import { TESS_EPS, type TessOpts } from './tessellate.js';
import { segToPoly } from './xform.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/**
 * Tolerância de junção de pontas, em mm. 0,02 mm é menor que o kerf de qualquer
 * laser e maior que o arredondamento de um DXF salvo com 6 decimais — é a faixa
 * onde "duas pontas no mesmo lugar" significa mesmo isso.
 */
export const CHAIN_TOL_MM = 0.02;

/** Teto duro de contornos. Acima disso não é orçamento, é bomba de geometria. */
export const MAX_CONTORNOS = 20_000;

/** Fenda até aqui é falha de desenho ("quase fechado"); acima, é linha solta. */
export const GAP_QUASE_FECHADO_MM = 1;

/** Furo abaixo de `fator × espessura` costuma não vazar no material. */
export const FURO_MIN_FATOR = 1.2;

/** Divergência do fecho convexo que levanta suspeita de auto-interseção. */
export const HULL_DIVERGENCIA = 0.4;

/** Acima disto o teste O(n²) de auto-interseção sai caro; fica inconclusivo. */
export const MAX_PTS_AUTO_INTERSEC = 2000;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface CadContour {
	/** `<idDaPeça>#<n>` — estável dentro de uma análise, citável no diagnóstico. */
	id: string;
	parte: string;
	/** Quantidade de instâncias da peça a que este contorno pertence. */
	qty: number;
	layer: LayerId;
	closed: boolean;
	/** Polilinha achatada (containment, fecho convexo). Fechada NÃO repete o 1º ponto. */
	pts: Pt[];
	/** Segmentos canônicos, na ordem e no SENTIDO do percurso da cadeia. */
	segs: Seg[];
	/** Comprimento exato (forma canônica), em mm. */
	lengthMm: number;
	/** Área com sinal exata (shoelace + correção de arcos). Aberto = 0. */
	areaSigned: number;
	bbox: BBox;
	/** 0 = peça; 1 = furo; 2 = ilha dentro do furo; ... */
	depth: number;
	/** Índice em `contornos` do MENOR contorno que contém este. */
	parent: number | null;
	children: number[];
	/** Distância entre as duas pontas de um contorno aberto, em mm. */
	gapMm: number;
	/** Índices dos caminhos de entrada (posição em `part.paths`). */
	origem: number[];
	degenerado: boolean;
	/**
	 * `true` = auto-interseção CONFIRMADA (área do shoelace não vale);
	 * `null` = suspeita não confirmada (contorno grande demais para o teste).
	 */
	autoIntersec: boolean | null;
}

export interface CadPeca {
	id: string;
	parte: string;
	qty: number;
	/** Contorno externo; `null` só em pseudo-peça de geometria solta. */
	contorno: number | null;
	/** Peça que não fecha — entra no relatório, não vira área. */
	aberta: boolean;
	bbox: BBox;
	/** W·H da caixa envolvente: é o que consome chapa. */
	areaBrutaMm2: number;
	/** Área do material que sobra na peça (descontados os furos). */
	areaLiquidaMm2: number;
	comprimentoCorteMm: number;
	furos: number;
}

export interface CadDuplicados {
	/** Grupos de entidades idênticas empilhadas. */
	grupos: number;
	/** Entidades EXCEDENTES (o grupo de 2 cópias conta 1 excedente). */
	segmentos: number;
	/** Comprimento cortado 2× por causa das cópias, em mm. */
	comprimentoMm: number;
	ids: string[];
}

export interface CadMetrics {
	/** Σ dos segmentos das layers de CORTE, já × qty. */
	comprimento_corte_mm: number;
	/** O mesmo, descontando o que é cópia empilhada — o preço "se você limpar". */
	comprimento_corte_limpo_mm: number;
	/** GRAVACAO + MARCACAO + DOBRA (passes de baixa potência), já × qty. */
	comprimento_gravacao_mm: number;
	n_contornos: number;
	n_abertos: number;
	/** 1 perfuração por contorno de corte (aberto também precisa furar para entrar). */
	n_piercings: number;
	/** Contornos fechados de profundidade ÍMPAR. */
	n_furos: number;
	n_pecas: number;
	/** Envelope do desenho. Em arquivo lido é a caixa da peça única. */
	bbox: BBox;
	/** Σ (W·H × qty) das caixas envolventes — consumo de chapa, não área do contorno. */
	area_bruta_mm2: number;
	/** Σ_{depth par} |A| − Σ_{depth ímpar} |A|, já × qty. É o que dá o PESO. */
	area_liquida_mm2: number;
	tol_mm: number;
	eps_mm: number;
	contornos: CadContour[];
	pecas: CadPeca[];
	duplicados: CadDuplicados;
	/** Nós de grau > 2 encontrados no encadeamento (geometria suja). */
	bifurcacoes: number;
	/** Entidades de comprimento nulo descartadas. */
	degenerados: number;
	/** Textos na layer de CORTE — o laser não corta fonte. */
	textos_no_corte: number;
	textos: number;
	avisos: string[];
}

export type DiagSeverity = 'erro' | 'aviso' | 'info';

export interface Diagnostic {
	code: string;
	severity: DiagSeverity;
	/** PT-BR e ACIONÁVEL: o que está errado e o que fazer no CAD. */
	message: string;
	count?: number;
	ids?: string[];
}

export interface AnalyzeOptions extends TessOpts {
	/** Tolerância de junção de pontas em mm (default `CHAIN_TOL_MM`). */
	tol?: number;
	/** Teto de contornos (default `MAX_CONTORNOS`). */
	maxContours?: number;
}

export interface DiagnoseOptions {
	/** Chapa disponível, em mm — habilita o teste de "peça maior que a chapa". */
	chapa?: { w: number; h: number } | null;
	/** Espessura do material, em mm — habilita o teste de furo pequeno. */
	espessura?: number | null;
	gapQuaseFechadoMm?: number;
	furoMinFator?: number;
}

// ---------------------------------------------------------------------------
// Utilitários de segmento
// ---------------------------------------------------------------------------

function ptEm(c: Pt, r: number, ang: number): Pt {
	return { x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) };
}

function dist(a: Pt, b: Pt): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Pontas de um segmento ABERTO. `null` para o que já é fechado (círculo,
 * polilinha fechada) ou não é geometria (texto): esses não entram no grafo de
 * encadeamento, viram contorno na hora.
 */
function pontasDe(seg: Seg): { a: Pt; b: Pt } | null {
	switch (seg.k) {
		case 'line':
			return { a: seg.a, b: seg.b };
		case 'arc':
			return {
				a: ptEm(seg.c, seg.r, seg.a0),
				b: ptEm(seg.c, seg.r, seg.a1),
			};
		case 'poly':
			if (seg.closed || seg.pts.length < 2) return null;
			return { a: seg.pts[0], b: seg.pts[seg.pts.length - 1] };
		case 'circle':
		case 'text':
			return null;
	}
}

/**
 * Inverte o sentido de percurso de um segmento. Arco troca as pontas E o
 * sentido; no bulge, inverter o percurso troca o SINAL (o arco passa a ficar do
 * outro lado da corda em relação à direção de caminhada) — errar isso transforma
 * canto arredondado em canto mordido.
 */
function inverterSeg(seg: Seg): Seg {
	switch (seg.k) {
		case 'line':
			return { k: 'line', a: seg.b, b: seg.a };
		case 'arc':
			return { ...seg, a0: seg.a1, a1: seg.a0, ccw: !seg.ccw };
		case 'poly': {
			const pts = [...seg.pts].reverse();
			const n = seg.pts.length;
			if (!seg.bulges) return { ...seg, pts };
			const bulges: number[] = [];
			// bulges[i] vale para o trecho que SAI do vértice i; invertido, o trecho
			// que sai de i é o que antes saía de (n-2-i), com o sinal trocado.
			for (let i = 0; i < n - 1; i++)
				bulges.push(-(seg.bulges[n - 2 - i] ?? 0));
			return { ...seg, pts, bulges };
		}
		case 'circle':
		case 'text':
			return seg;
	}
}

/** Polilinha achatada de um segmento, no sentido em que ele está. */
function achatar(seg: Seg, opts?: TessOpts): Pt[] {
	const flat = segToPoly(seg, opts);
	return flat ? flat.pts : [];
}

// ---------------------------------------------------------------------------
// Área exata: shoelace nos vértices canônicos + correção dos arcos
// ---------------------------------------------------------------------------

/**
 * Área de segmento circular com sinal: `(θ − sen θ)·r²/2`, com θ SINALIZADO
 * (positivo = arco percorrido no anti-horário). É exatamente o que a troca de
 * uma corda por um arco acrescenta à integral de Green — e como `θ − sen θ` é
 * ímpar, o mesmo termo serve para arco que infla e para arco que morde.
 */
function areaDoArco(r: number, thetaSinalizado: number): number {
	return ((thetaSinalizado - Math.sin(thetaSinalizado)) * r * r) / 2;
}

interface AcumArea {
	verts: Pt[];
	corr: number;
}

/** Empilha os vértices canônicos de um segmento (menos o último) e as correções. */
function acumularArea(acc: AcumArea, seg: Seg, ultimo: boolean): void {
	switch (seg.k) {
		case 'line':
			acc.verts.push(seg.a);
			if (ultimo) acc.verts.push(seg.b);
			return;
		case 'arc': {
			acc.verts.push(ptEm(seg.c, seg.r, seg.a0));
			if (ultimo) acc.verts.push(ptEm(seg.c, seg.r, seg.a1));
			const sweep = arcSweep(seg.a0, seg.a1, seg.ccw);
			acc.corr += areaDoArco(seg.r, seg.ccw ? sweep : -sweep);
			return;
		}
		case 'poly': {
			const n = seg.pts.length;
			const fim = seg.closed ? n : n - 1;
			for (let i = 0; i < fim; i++) {
				acc.verts.push(seg.pts[i]);
				const b = seg.bulges?.[i] ?? 0;
				if (Math.abs(b) < EPS) continue;
				const arco = arcFromBulge(seg.pts[i], seg.pts[(i + 1) % n], b);
				if (arco) acc.corr += areaDoArco(arco.r, sweepFromBulge(b));
			}
			if (!seg.closed && ultimo) acc.verts.push(seg.pts[n - 1]);
			return;
		}
		case 'circle':
			// Círculo sozinho não tem corda: a área é fechada e o sentido é o
			// anti-horário por convenção da IR.
			acc.corr += (TAU / 2) * seg.r * seg.r;
			return;
		case 'text':
			return;
	}
}

function shoelace(pts: Pt[]): number {
	if (pts.length < 3) return 0;
	let acc = 0;
	for (let i = 0; i < pts.length; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % pts.length];
		acc += a.x * b.y - b.x * a.y;
	}
	return acc / 2;
}

/** Área com sinal EXATA de uma cadeia fechada de segmentos canônicos. */
function areaExata(segs: Seg[]): number {
	if (segs.length === 1 && segs[0].k === 'circle') {
		return (TAU / 2) * segs[0].r * segs[0].r;
	}
	const acc: AcumArea = { verts: [], corr: 0 };
	for (const seg of segs) acumularArea(acc, seg, false);
	return shoelace(acc.verts) + acc.corr;
}

// ---------------------------------------------------------------------------
// Malha espacial de pontas
// ---------------------------------------------------------------------------

/**
 * Hash espacial com célula = `tol`: assim a vizinhança 3×3 cobre todo ponto a
 * menos de `tol`, e a busca é O(1) em vez do O(n²) que travaria num arquivo com
 * 50 mil pontas.
 */
function criarMalha(tol: number) {
	const nos: Pt[] = [];
	const celulas = new Map<string, number[]>();
	const buscar = (p: Pt): number => {
		const ci = Math.floor(p.x / tol);
		const cj = Math.floor(p.y / tol);
		let melhor = -1;
		let melhorD = tol;
		for (let di = -1; di <= 1; di++) {
			for (let dj = -1; dj <= 1; dj++) {
				const lista = celulas.get(`${ci + di}|${cj + dj}`);
				if (!lista) continue;
				for (const n of lista) {
					const d = dist(nos[n], p);
					if (d <= melhorD) {
						melhorD = d;
						melhor = n;
					}
				}
			}
		}
		if (melhor >= 0) return melhor;
		const id = nos.length;
		nos.push({ x: p.x, y: p.y });
		const chave = `${ci}|${cj}`;
		const lista = celulas.get(chave);
		if (lista) lista.push(id);
		else celulas.set(chave, [id]);
		return id;
	};
	return { nos, buscar };
}

// ---------------------------------------------------------------------------
// Encadeamento
// ---------------------------------------------------------------------------

interface Aberta {
	idx: number;
	seg: Seg;
	a: number;
	b: number;
}

export interface Cadeia {
	layer: LayerId;
	segs: Seg[];
	pts: Pt[];
	closed: boolean;
	lengthMm: number;
	gapMm: number;
	origem: number[];
	degenerado: boolean;
}

export interface ChainResult {
	cadeias: Cadeia[];
	/** Nós de grau > 2: linha duplicada, contorno cruzado, geometria suja. */
	bifurcacoes: number;
	degenerados: number;
	textos: number;
	textosNoCorte: number;
}

/**
 * Junta segmentos soltos em contornos. Uma cadeia cresce pelas DUAS pontas
 * enquanto o nó tiver grau ≤ 2 e exatamente um vizinho ainda não visitado; nó de
 * grau > 2 é bifurcação (linha em cima de linha, ou dois contornos que se
 * tocam): a cadeia FECHA ali e o caso é contado. Continuar chutando um dos ramos
 * seria inventar geometria que o cliente não desenhou.
 *
 * Encadeia por LAYER: uma linha de gravação que encosta no contorno de corte não
 * pode virar parte dele.
 */
export function chainContours(
	paths: CadPath[],
	opts?: AnalyzeOptions,
): ChainResult {
	const tol = tolDe(opts);
	const cadeias: Cadeia[] = [];
	let bifurcacoes = 0;
	let degenerados = 0;
	let textos = 0;
	let textosNoCorte = 0;

	const porLayer = new Map<LayerId, number[]>();
	paths.forEach((p, i) => {
		if (p.layer === 'REFERENCIA') {
			if (p.seg.k === 'text') textos += 1;
			return;
		}
		if (p.seg.k === 'text') {
			textos += 1;
			if (p.layer === 'CORTE') textosNoCorte += 1;
			return;
		}
		const lista = porLayer.get(p.layer);
		if (lista) lista.push(i);
		else porLayer.set(p.layer, [i]);
	});

	for (const [layer, indices] of porLayer) {
		const abertas: Aberta[] = [];
		const malha = criarMalha(tol);

		for (const idx of indices) {
			const seg = paths[idx].seg;
			const len = segLength(seg);
			const pontas = pontasDe(seg);
			if (pontas === null) {
				// Já é um contorno fechado (círculo / polilinha fechada).
				if (len <= EPS) {
					degenerados += 1;
					continue;
				}
				const pts = achatar(seg, opts);
				cadeias.push({
					layer,
					segs: [seg],
					pts,
					closed: pts.length >= 3,
					lengthMm: len,
					gapMm: 0,
					origem: [idx],
					degenerado: pts.length < 3,
				});
				continue;
			}
			if (len <= EPS) {
				// Entidade de comprimento nulo: não é corte, e no grafo ela colaria
				// duas cadeias que não se tocam.
				degenerados += 1;
				continue;
			}
			abertas.push({
				idx,
				seg,
				a: malha.buscar(pontas.a),
				b: malha.buscar(pontas.b),
			});
		}

		if (abertas.length === 0) continue;

		const adj = new Map<number, number[]>();
		const liga = (no: number, i: number): void => {
			const lista = adj.get(no);
			if (lista) lista.push(i);
			else adj.set(no, [i]);
		};
		abertas.forEach((e, i) => {
			liga(e.a, i);
			liga(e.b, i);
		});
		const grau = (no: number): number => adj.get(no)?.length ?? 0;

		const visitado = new Array<boolean>(abertas.length).fill(false);
		const bifs = new Set<number>();

		for (let i = 0; i < abertas.length; i++) {
			if (visitado[i]) continue;
			visitado[i] = true;
			const trilha: Array<{ e: Aberta; rev: boolean }> = [
				{ e: abertas[i], rev: false },
			];
			const noInicio = abertas[i].a;
			let noFim = abertas[i].b;

			// Cresce pela frente.
			while (noFim !== noInicio) {
				if (grau(noFim) > 2) {
					bifs.add(noFim);
					break;
				}
				const prox = (adj.get(noFim) ?? []).find((j) => !visitado[j]);
				if (prox === undefined) break;
				visitado[prox] = true;
				const e = abertas[prox];
				const rev = e.a !== noFim;
				trilha.push({ e, rev });
				noFim = rev ? e.a : e.b;
			}

			// Cresce por trás (só se não fechou).
			let noRaiz = noInicio;
			while (noFim !== noRaiz) {
				if (grau(noRaiz) > 2) {
					bifs.add(noRaiz);
					break;
				}
				const prox = (adj.get(noRaiz) ?? []).find((j) => !visitado[j]);
				if (prox === undefined) break;
				visitado[prox] = true;
				const e = abertas[prox];
				// Precisa TERMINAR no nó raiz: se termina em `b`, segue direto.
				const rev = e.b !== noRaiz;
				trilha.unshift({ e, rev });
				noRaiz = rev ? e.b : e.a;
			}

			cadeias.push(montarCadeia(layer, trilha, tol, opts));
		}
		bifurcacoes += bifs.size;
	}

	return { cadeias, bifurcacoes, degenerados, textos, textosNoCorte };
}

function montarCadeia(
	layer: LayerId,
	trilha: Array<{ e: Aberta; rev: boolean }>,
	tol: number,
	opts?: TessOpts,
): Cadeia {
	const segs: Seg[] = [];
	const pts: Pt[] = [];
	const origem: number[] = [];
	let lengthMm = 0;
	for (const { e, rev } of trilha) {
		const seg = rev ? inverterSeg(e.seg) : e.seg;
		segs.push(seg);
		origem.push(e.idx);
		lengthMm += segLength(seg);
		const flat = achatar(seg, opts);
		for (const p of flat) {
			// Junção: a ponta do anterior e a do próximo são o MESMO ponto físico
			// (a menos de tol) — repetir gera aresta de comprimento zero no shoelace.
			if (pts.length > 0 && dist(pts[pts.length - 1], p) <= tol) continue;
			pts.push(p);
		}
	}
	const gap = pts.length >= 2 ? dist(pts[0], pts[pts.length - 1]) : 0;
	const fechado = pts.length >= 4 && gap <= tol;
	// Fechada não repete o primeiro ponto: a IR fecha implicitamente.
	if (fechado) pts.pop();
	return {
		layer,
		segs,
		pts,
		closed: fechado,
		lengthMm,
		gapMm: fechado ? 0 : gap,
		origem,
		degenerado: pts.length < 2,
	};
}

// ---------------------------------------------------------------------------
// Containment (even-odd)
// ---------------------------------------------------------------------------

/** Ray casting clássico (regra do cruzamento) na polilinha achatada. */
function pontoDentro(p: Pt, poly: Pt[]): boolean {
	let dentro = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i];
		const b = poly[j];
		if (a.y > p.y !== b.y > p.y) {
			const xInt = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
			if (p.x < xInt) dentro = !dentro;
		}
	}
	return dentro;
}

/**
 * Ponto de prova de um contorno: o 1º vértice deslocado até `tol` na direção do
 * centro da caixa. O deslocamento existe para o caso clássico de dois contornos
 * que compartilham vértice (furo encostado na borda): o ray casting em cima da
 * aresta do outro contorno responde a moeda ao ar.
 */
function pontoDeProva(pts: Pt[], bb: BBox, tol: number): Pt {
	const p0 = pts[0];
	const cx = (bb.minX + bb.maxX) / 2;
	const cy = (bb.minY + bb.maxY) / 2;
	const dx = cx - p0.x;
	const dy = cy - p0.y;
	const d = Math.hypot(dx, dy);
	if (!(d > EPS)) return p0;
	const passo = Math.min(tol, d / 2);
	return { x: p0.x + (dx / d) * passo, y: p0.y + (dy / d) * passo };
}

function bboxContem(fora: BBox, dentro: BBox, tol: number): boolean {
	return (
		fora.minX - tol <= dentro.minX &&
		fora.minY - tol <= dentro.minY &&
		fora.maxX + tol >= dentro.maxX &&
		fora.maxY + tol >= dentro.maxY
	);
}

// ---------------------------------------------------------------------------
// Suspeita de auto-interseção
// ---------------------------------------------------------------------------

function areaFechoConvexo(pts: Pt[]): number {
	if (pts.length < 3) return 0;
	const ord = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
	const cross = (o: Pt, a: Pt, b: Pt): number =>
		(a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const meio = (arr: Pt[], q: Pt): void => {
		while (
			arr.length >= 2 &&
			cross(arr[arr.length - 2], arr[arr.length - 1], q) <= 0
		) {
			arr.pop();
		}
		arr.push(q);
	};
	const baixo: Pt[] = [];
	for (const q of ord) meio(baixo, q);
	const alto: Pt[] = [];
	for (let i = ord.length - 1; i >= 0; i--) meio(alto, ord[i]);
	const hull = [...baixo.slice(0, -1), ...alto.slice(0, -1)];
	return Math.abs(shoelace(hull));
}

function cruzam(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
	const o = (p: Pt, q: Pt, r: Pt): number =>
		(q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
	const d1 = o(a, b, c);
	const d2 = o(a, b, d);
	const d3 = o(c, d, a);
	const d4 = o(c, d, b);
	// Só cruzamento PRÓPRIO: tocar de raspão é ruído de arredondamento, não é
	// contorno em oito.
	return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * `true` = achou cruzamento próprio; `false` = não achou; `null` = contorno
 * grande demais para o teste O(n²), fica na dúvida (e a dúvida é reportada).
 */
function autoIntersecta(pts: Pt[]): boolean | null {
	const n = pts.length;
	if (n < 4) return false;
	if (n > MAX_PTS_AUTO_INTERSEC) return null;
	for (let i = 0; i < n; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % n];
		for (let j = i + 2; j < n; j++) {
			if (i === 0 && j === n - 1) continue; // arestas vizinhas pelo fechamento
			if (cruzam(a, b, pts[j], pts[(j + 1) % n])) return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Duplicatas
// ---------------------------------------------------------------------------

/**
 * Chave canônica de uma entidade: tipo + comprimento + caixa + as duas pontas
 * ordenadas, tudo arredondado a `tol`. O comprimento e o tipo entram na chave de
 * propósito — só as pontas colidiriam a corda e o arco que ligam os mesmos dois
 * vértices, e mandar o profissional apagar um arco "duplicado" que não é
 * duplicado estragaria a peça dele.
 */
function chaveCanonica(seg: Seg, layer: LayerId, tol: number): string | null {
	if (seg.k === 'text') return null;
	const q = (v: number): number => Math.round(v / tol);
	const bb = bboxOf([{ layer, seg }]);
	const len = Math.round(segLength(seg) / tol);
	const pontas = pontasDe(seg);
	let extremos = '';
	if (pontas) {
		const a = `${q(pontas.a.x)},${q(pontas.a.y)}`;
		const b = `${q(pontas.b.x)},${q(pontas.b.y)}`;
		extremos = a <= b ? `${a}|${b}` : `${b}|${a}`;
	} else if (seg.k === 'circle') {
		extremos = `c${q(seg.c.x)},${q(seg.c.y)},${q(seg.r)}`;
	} else if (seg.k === 'poly') {
		extremos = `p${seg.pts.length}|${q(seg.pts[0]?.x ?? 0)},${q(seg.pts[0]?.y ?? 0)}`;
	}
	return `${layer}|${seg.k}|${len}|${q(bb.minX)},${q(bb.minY)},${q(bb.maxX)},${q(bb.maxY)}|${extremos}`;
}

function acharDuplicados(parts: Sketch2D['parts'], tol: number): CadDuplicados {
	const grupos = new Map<string, { n: number; len: number; ids: string[] }>();
	for (const part of parts) {
		const qty = Math.max(0, Math.round(part.qty));
		if (qty === 0) continue;
		part.paths.forEach((p, i) => {
			if (p.layer === 'REFERENCIA') return;
			const chave = chaveCanonica(p.seg, p.layer, tol);
			if (chave === null) return;
			const k = `${part.id}|${chave}`;
			const g = grupos.get(k);
			if (g) {
				g.n += 1;
				g.ids.push(p.id ?? `${part.id}#p${i}`);
			} else {
				grupos.set(k, {
					n: 1,
					len: segLength(p.seg) * qty,
					ids: [p.id ?? `${part.id}#p${i}`],
				});
			}
		});
	}
	let nGrupos = 0;
	let segmentos = 0;
	let comprimentoMm = 0;
	const ids: string[] = [];
	for (const g of grupos.values()) {
		if (g.n < 2) continue;
		nGrupos += 1;
		segmentos += g.n - 1;
		comprimentoMm += g.len * (g.n - 1);
		ids.push(...g.ids);
	}
	return { grupos: nGrupos, segmentos, comprimentoMm, ids };
}

// ---------------------------------------------------------------------------
// analyzeGeometry
// ---------------------------------------------------------------------------

function tolDe(opts?: AnalyzeOptions): number {
	const t = opts?.tol;
	return typeof t === 'number' && Number.isFinite(t) && t > 0
		? t
		: CHAIN_TOL_MM;
}

/**
 * Topologia + métricas determinísticas do sketch inteiro. Contagens e
 * comprimentos saem do JOB (já multiplicados pelo `qty` de cada peça), igual a
 * `computeStats` — é isso que a precificação cobra.
 */
export function analyzeGeometry(
	sketch: Sketch2D,
	opts?: AnalyzeOptions,
): CadMetrics {
	const tol = tolDe(opts);
	const eps =
		typeof opts?.eps === 'number' && opts.eps > 0 ? opts.eps : TESS_EPS;
	const teto = Math.max(1, opts?.maxContours ?? MAX_CONTORNOS);

	const contornos: CadContour[] = [];
	const pecas: CadPeca[] = [];
	const avisos: string[] = [];
	let bifurcacoes = 0;
	let degenerados = 0;
	let textos = 0;
	let textosNoCorte = 0;
	let comprimentoCorte = 0;
	let comprimentoGravacao = 0;
	let areaBruta = 0;
	let areaLiquida = 0;
	let nContornos = 0;
	let nAbertos = 0;
	let nPiercings = 0;
	let nFuros = 0;
	let nPecas = 0;
	let todosPaths: CadPath[] = [];

	for (const part of sketch.parts) {
		const qty = Math.max(0, Math.round(part.qty));
		if (qty === 0) continue;
		todosPaths = todosPaths.concat(part.paths);
		areaBruta += part.bbox.w * part.bbox.h * qty;

		const r = chainContours(part.paths, { ...opts, eps });
		bifurcacoes += r.bifurcacoes;
		degenerados += r.degenerados;
		textos += r.textos * qty;
		textosNoCorte += r.textosNoCorte * qty;

		if (contornos.length + r.cadeias.length > teto) {
			throw new ToolEngineError(
				413,
				`O desenho tem mais de ${teto} contornos — está fora do que esta ferramenta orça. ` +
					'Provavelmente é uma gravura raster convertida em vetor: simplifique o arquivo ou separe a gravação do corte.',
			);
		}

		const base = contornos.length;
		for (const c of r.cadeias) {
			const bb = bboxOf(c.segs.map((seg) => ({ layer: c.layer, seg })));
			const areaSigned = c.closed ? areaExata(c.segs) : 0;
			// Suspeita de auto-interseção: a área do shoelace divergir muito do fecho
			// convexo é o sintoma. A heurística sozinha acusaria todo painel com
			// dentes, então o veredito vem do teste de cruzamento próprio.
			let autoIntersec: boolean | null = false;
			if (c.closed && c.layer === 'CORTE') {
				const hull = areaFechoConvexo(c.pts);
				if (hull > 0 && Math.abs(areaSigned) < hull * (1 - HULL_DIVERGENCIA)) {
					autoIntersec = autoIntersecta(c.pts);
				}
			}
			// Fechado com área nula é artefato (linha ida-e-volta, contorno colapsado):
			// não é peça nem furo, e deixá-lo entrar criaria uma peça de 0 mm².
			// EXCEÇÃO: contorno em oito também dá área ~0 — esse não pode sumir
			// calado, é justamente o caso que precisa aparecer no relatório.
			const degenerado =
				c.degenerado ||
				(c.closed && Math.abs(areaSigned) < tol * tol && autoIntersec !== true);
			contornos.push({
				id: `${part.id}#${contornos.length - base}`,
				parte: part.id,
				qty,
				layer: c.layer,
				closed: c.closed,
				pts: c.pts,
				segs: c.segs,
				lengthMm: c.lengthMm,
				areaSigned,
				bbox: bb,
				depth: 0,
				parent: null,
				children: [],
				gapMm: c.gapMm,
				origem: c.origem,
				degenerado,
				autoIntersec,
			});
			if (c.layer === 'CORTE') comprimentoCorte += c.lengthMm * qty;
			else comprimentoGravacao += c.lengthMm * qty;
		}

		// --- Containment even-odd, só entre contornos de CORTE desta peça ---
		const idxs: number[] = [];
		for (let i = base; i < contornos.length; i++) {
			if (contornos[i].layer === 'CORTE' && !contornos[i].degenerado) {
				idxs.push(i);
			}
		}
		const fechados = idxs
			.filter((i) => contornos[i].closed)
			.sort(
				(a, b) =>
					Math.abs(contornos[b].areaSigned) - Math.abs(contornos[a].areaSigned),
			);

		// O pai é o MENOR contorno que contém — por isso a varredura vem do fim
		// (menor área) para o começo. Ordenado por área decrescente, todo pai já
		// tem `depth` resolvido quando o filho é processado.
		for (let k = 0; k < fechados.length; k++) {
			const i = fechados[k];
			const c = contornos[i];
			const prova = pontoDeProva(c.pts, c.bbox, tol);
			for (let m = k - 1; m >= 0; m--) {
				const j = fechados[m];
				const pai = contornos[j];
				// Quem contém é ESTRITAMENTE maior. Sem esta linha, duas cópias
				// idênticas do mesmo contorno (o caso mais comum de arquivo sujo)
				// virariam "peça + furo do mesmo tamanho" e a área líquida daria ZERO.
				if (!(Math.abs(pai.areaSigned) > Math.abs(c.areaSigned) + tol * tol)) {
					continue;
				}
				if (!bboxContem(pai.bbox, c.bbox, tol)) continue;
				if (!pontoDentro(prova, pai.pts)) continue;
				c.parent = j;
				c.depth = pai.depth + 1;
				pai.children.push(i);
				break;
			}
		}

		// Contorno ABERTO: se cai dentro de uma peça é uma linha solta lá dentro;
		// se não, é uma pseudo-peça "geometria solta" (o cliente mandou um rabisco
		// que ninguém sabe se é corte).
		for (const i of idxs) {
			const c = contornos[i];
			if (c.closed || c.pts.length === 0) continue;
			const prova = pontoDeProva(c.pts, c.bbox, tol);
			for (let m = fechados.length - 1; m >= 0; m--) {
				const j = fechados[m];
				const pai = contornos[j];
				if (!bboxContem(pai.bbox, c.bbox, tol)) continue;
				if (!pontoDentro(prova, pai.pts)) continue;
				c.parent = j;
				c.depth = pai.depth + 1;
				pai.children.push(i);
				break;
			}
		}

		// --- Peças ---
		const pecasAntes = pecas.length;
		for (const i of idxs) {
			const c = contornos[i];
			if (c.depth !== 0) continue;
			if (!c.closed) {
				pecas.push({
					id: `${part.id}:solta:${i}`,
					parte: part.id,
					qty,
					contorno: i,
					aberta: true,
					bbox: c.bbox,
					areaBrutaMm2: c.bbox.w * c.bbox.h,
					areaLiquidaMm2: 0,
					comprimentoCorteMm: c.lengthMm,
					furos: 0,
				});
				continue;
			}
			let area = 0;
			let corte = 0;
			let furos = 0;
			const pilha = [i];
			while (pilha.length > 0) {
				const j = pilha.pop();
				if (j === undefined) break;
				const d = contornos[j];
				corte += d.lengthMm;
				if (d.closed) {
					area +=
						d.depth % 2 === 0
							? Math.abs(d.areaSigned)
							: -Math.abs(d.areaSigned);
					if (d.depth % 2 === 1) furos += 1;
				}
				for (const f of d.children) pilha.push(f);
			}
			pecas.push({
				id: `${part.id}:${i}`,
				parte: part.id,
				qty,
				contorno: i,
				aberta: false,
				bbox: c.bbox,
				areaBrutaMm2: c.bbox.w * c.bbox.h,
				areaLiquidaMm2: area,
				comprimentoCorteMm: corte,
				furos,
			});
		}

		// --- Contagens do CORTE, já × qty ---
		for (const i of idxs) {
			const c = contornos[i];
			nContornos += qty;
			nPiercings += qty;
			if (!c.closed) nAbertos += qty;
			else {
				if (c.depth % 2 === 1) nFuros += qty;
				areaLiquida +=
					(c.depth % 2 === 0
						? Math.abs(c.areaSigned)
						: -Math.abs(c.areaSigned)) * qty;
			}
		}
		nPecas += (pecas.length - pecasAntes) * qty;
	}

	if (bifurcacoes > 0) {
		avisos.push(
			`Encontrei ${bifurcacoes} ponto(s) onde 3 ou mais linhas se encontram; o contorno foi fechado ali. Costuma ser linha desenhada em cima de linha.`,
		);
	}
	if (nAbertos > 0) {
		avisos.push(
			`${nAbertos} contorno(s) de corte não fecham — não viram peça e não entram na área líquida.`,
		);
	}
	const soltas = pecas.filter((p) => p.aberta).length;
	if (soltas > 0) {
		avisos.push(
			`${soltas} trecho(s) de geometria solta contabilizados como pseudo-peça: confira se é corte de verdade.`,
		);
	}

	const duplicados = acharDuplicados(sketch.parts, tol);

	return {
		comprimento_corte_mm: comprimentoCorte,
		comprimento_corte_limpo_mm: Math.max(
			0,
			comprimentoCorte - duplicados.comprimentoMm,
		),
		comprimento_gravacao_mm: comprimentoGravacao,
		n_contornos: nContornos,
		n_abertos: nAbertos,
		n_piercings: nPiercings,
		n_furos: nFuros,
		n_pecas: nPecas,
		bbox: bboxOf(todosPaths),
		area_bruta_mm2: areaBruta,
		area_liquida_mm2: areaLiquida,
		tol_mm: tol,
		eps_mm: eps,
		contornos,
		pecas,
		duplicados,
		bifurcacoes,
		degenerados,
		textos_no_corte: textosNoCorte,
		textos,
		avisos,
	};
}

// ---------------------------------------------------------------------------
// diagnose
// ---------------------------------------------------------------------------

function mm(v: number): string {
	return v.toLocaleString('pt-BR', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

const ORDEM: Record<DiagSeverity, number> = { erro: 0, aviso: 1, info: 2 };

/**
 * O relatório que o profissional lê. Cada item diz o que está errado, quanto
 * custa e o que fazer no CAD — é aqui que a ferramenta deixa de ser calculadora
 * e passa a ensinar.
 */
export function diagnose(
	sketch: Sketch2D,
	metrics: CadMetrics,
	opts?: DiagnoseOptions,
): Diagnostic[] {
	const out: Diagnostic[] = [];
	const gapMax = opts?.gapQuaseFechadoMm ?? GAP_QUASE_FECHADO_MM;
	const fator = opts?.furoMinFator ?? FURO_MIN_FATOR;
	const corte = metrics.contornos.filter((c) => c.layer === 'CORTE');

	// 1. Linha em cima de linha — o profissional paga 2× hoje e não sabe.
	if (metrics.duplicados.segmentos > 0) {
		out.push({
			code: 'linha_duplicada',
			severity: 'aviso',
			count: metrics.duplicados.segmentos,
			ids: metrics.duplicados.ids.slice(0, 40),
			message:
				`${metrics.duplicados.segmentos} entidade(s) desenhada(s) exatamente em cima de outra igual, ` +
				`em ${metrics.duplicados.grupos} lugar(es): ${mm(metrics.duplicados.comprimentoMm)} mm de corte repetido. ` +
				'O laser passa duas vezes no mesmo lugar — você paga o dobro nesse trecho e a borda queima. ' +
				'Apague as cópias no CAD (no AutoCAD, comando OVERKILL) e recalcule.',
		});
	}

	// 2. Contorno que não fecha.
	const quase = corte.filter(
		(c) => !c.closed && !c.degenerado && c.gapMm <= gapMax,
	);
	if (quase.length > 0) {
		const maior = quase.reduce((m, c) => Math.max(m, c.gapMm), 0);
		out.push({
			code: 'contorno_quase_fechado',
			severity: 'aviso',
			count: quase.length,
			ids: quase.map((c) => c.id).slice(0, 40),
			message:
				`${quase.length} contorno(s) quase fechado(s) — falta até ${mm(maior)} mm para juntar as pontas. ` +
				'Isso é falha de desenho, não escolha: contorno aberto não vira peça, não tem área e o laser ' +
				'corta um rasgo em vez de soltar a peça. Feche o contorno no CAD (JOIN/FECHAR) antes de orçar.',
		});
	}
	const soltas = corte.filter(
		(c) => !c.closed && !c.degenerado && c.gapMm > gapMax,
	);
	if (soltas.length > 0) {
		out.push({
			code: 'linha_solta',
			severity: 'aviso',
			count: soltas.length,
			ids: soltas.map((c) => c.id).slice(0, 40),
			message:
				`${soltas.length} traço(s) de corte solto(s) (pontas a mais de ${mm(gapMax)} mm de distância). ` +
				'Se for gravação, mude para uma camada com nome começando em "grav"; se for sobra de desenho, apague — ' +
				'do jeito que está, a máquina vai furar e cortar cada um deles.',
		});
	}

	// 3. Texto na camada de corte.
	if (metrics.textos_no_corte > 0) {
		out.push({
			code: 'texto_nao_vetorizado',
			severity: 'aviso',
			count: metrics.textos_no_corte,
			message:
				`${metrics.textos_no_corte} texto(s) na camada de CORTE. Texto de CAD não é vetor: ` +
				'ele não entra no comprimento cortado deste orçamento e cada máquina desenha de um jeito. ' +
				'Converta em curvas no CAD (explodir/EXPLODE ou "converter em polilinha") ou mova para a camada de gravação.',
		});
	}

	// 4. Peça maior que a chapa — testando girar 90°.
	const chapa = opts?.chapa;
	if (chapa && chapa.w > 0 && chapa.h > 0) {
		const grandes = metrics.pecas.filter((p) => {
			const cabe =
				(p.bbox.w <= chapa.w + 1e-6 && p.bbox.h <= chapa.h + 1e-6) ||
				(p.bbox.h <= chapa.w + 1e-6 && p.bbox.w <= chapa.h + 1e-6);
			return !cabe;
		});
		if (grandes.length > 0) {
			const pior = grandes.reduce((a, b) =>
				a.bbox.w * a.bbox.h >= b.bbox.w * b.bbox.h ? a : b,
			);
			out.push({
				code: 'peca_maior_que_chapa',
				severity: 'erro',
				count: grandes.length,
				ids: grandes.map((p) => p.id).slice(0, 40),
				message:
					`${grandes.length} peça(s) não cabem na chapa de ${mm(chapa.w)} × ${mm(chapa.h)} mm ` +
					`nem girando 90° (a maior mede ${mm(pior.bbox.w)} × ${mm(pior.bbox.h)} mm). ` +
					'Use chapa maior ou divida a peça com encaixe.',
			});
		}
	}

	// 5. Escala suspeita: arquivo sem unidade declarada + tamanho fora da faixa.
	const diagArquivo = readDiagnostics(sketch);
	if (diagArquivo && diagArquivo.unidade.source === 'heuristica') {
		const orig = Math.max(
			diagArquivo.bboxOriginal.w,
			diagArquivo.bboxOriginal.h,
		);
		if (orig > 0 && (orig < 25 || orig > 3000)) {
			out.push({
				code: 'escala_suspeita',
				severity: 'aviso',
				message:
					`O arquivo não declara unidade e mede ${mm(orig)} unidades no maior lado — fora da faixa de uma ` +
					`peça de laser. Foi lido como ${diagArquivo.unidade.detected} ` +
					`(${mm(metrics.bbox.w)} × ${mm(metrics.bbox.h)} mm). Erro de unidade muda o preço por 25×: ` +
					'confirme a unidade antes de fechar o orçamento.',
			});
		}
	}

	// 6. Furo pequeno demais para vazar.
	const t = opts?.espessura;
	if (typeof t === 'number' && t > 0) {
		const minimo = fator * t;
		const furos = corte.filter(
			(c) =>
				c.closed &&
				c.depth % 2 === 1 &&
				Math.min(c.bbox.w, c.bbox.h) < minimo - 1e-9,
		);
		if (furos.length > 0) {
			const menor = furos.reduce(
				(m, c) => Math.min(m, c.bbox.w, c.bbox.h),
				Number.POSITIVE_INFINITY,
			);
			out.push({
				code: 'furo_pequeno',
				severity: 'aviso',
				count: furos.length,
				ids: furos.map((c) => c.id).slice(0, 40),
				message:
					`${furos.length} furo(s) menores que ${mm(minimo)} mm (${fator}× a espessura de ${mm(t)} mm) — ` +
					`o menor tem ${mm(menor)} mm. Nessa proporção o feixe não vaza direito: o furo sai cônico, ` +
					'fecha de novo no acrílico ou carboniza no MDF. Aumente o furo ou avise o cliente.',
			});
		}
	}

	// 7. Geometria degenerada.
	const degen = corte.filter((c) => c.degenerado).length + metrics.degenerados;
	if (degen > 0) {
		out.push({
			code: 'geometria_degenerada',
			severity: 'info',
			count: degen,
			message:
				`${degen} entidade(s) de comprimento zero (ponto, linha de tamanho nulo, círculo de raio 0) foram ignoradas. ` +
				'Não mudam o preço, mas costumam ser resto de edição — vale limpar o arquivo.',
		});
	}

	// 8. Bifurcações.
	if (metrics.bifurcacoes > 0) {
		out.push({
			code: 'bifurcacao',
			severity: 'aviso',
			count: metrics.bifurcacoes,
			message:
				`${metrics.bifurcacoes} ponto(s) com 3 ou mais linhas se encontrando. Cada um deles interrompeu ` +
				'o encadeamento do contorno, então a contagem de peças e furos pode estar errada. ' +
				'Quase sempre é linha em cima de linha ou dois contornos que se tocam num vértice.',
		});
	}

	// 9. Área não confiável.
	const cruzados = corte.filter((c) => c.autoIntersec === true);
	if (cruzados.length > 0) {
		out.push({
			code: 'auto_intersecao',
			severity: 'aviso',
			count: cruzados.length,
			ids: cruzados.map((c) => c.id).slice(0, 40),
			message:
				`${cruzados.length} contorno(s) cruzam a si mesmos (contorno "em oito"). A área desse contorno ` +
				'sai errada por definição — o peso e o custo de material calculados a partir dela não valem. ' +
				'Corrija o cruzamento no CAD e recalcule.',
		});
	}
	const duvidosos = corte.filter((c) => c.autoIntersec === null);
	if (duvidosos.length > 0) {
		out.push({
			code: 'area_duvidosa',
			severity: 'info',
			count: duvidosos.length,
			ids: duvidosos.map((c) => c.id).slice(0, 40),
			message:
				`${duvidosos.length} contorno(s) muito recortado(s) e grande(s) demais para eu confirmar se cruzam a si mesmos. ` +
				'Se o peso vier estranho, olhe esses contornos.',
		});
	}

	// 10. Entidade que o leitor não converteu.
	if (diagArquivo) {
		const ignoradas = Object.entries(diagArquivo.ignoradas ?? {}).filter(
			([, n]) => n > 0,
		);
		if (ignoradas.length > 0) {
			const total = ignoradas.reduce((s, [, n]) => s + n, 0);
			out.push({
				code: 'entidade_nao_suportada',
				severity: 'info',
				count: total,
				message:
					`${total} entidade(s) que não viram corte foram ignoradas (${ignoradas
						.map(([k, n]) => `${k}×${n}`)
						.join(', ')}). ` +
					'Hachura, cota e sólido não são caminho de máquina. Se alguma delas era o seu contorno, ' +
					'reexporte-a como linha, arco, polilinha ou spline.',
			});
		}
	}

	// 11. Nada utilizável: sem contorno FECHADO não existe área, peso nem preço
	// (pseudo-peça de geometria solta não conta como peça aqui).
	if (metrics.pecas.every((p) => p.aberta)) {
		out.push({
			code: 'sem_peca',
			severity: 'erro',
			message:
				'Não encontrei nenhuma peça fechada no desenho. Sem contorno fechado não há área, ' +
				'não há peso e não há preço: verifique se o contorno está na camada de corte e se as pontas se juntam.',
		});
	}

	return out.sort((a, b) => ORDEM[a.severity] - ORDEM[b.severity]);
}

/** Atalho para quem quer as duas coisas de uma vez (a camada de preço quer). */
export function analyzeAndDiagnose(
	sketch: Sketch2D,
	opts?: AnalyzeOptions & DiagnoseOptions,
): { metrics: CadMetrics; diagnostics: Diagnostic[] } {
	const metrics = analyzeGeometry(sketch, opts);
	return { metrics, diagnostics: diagnose(sketch, metrics, opts) };
}
