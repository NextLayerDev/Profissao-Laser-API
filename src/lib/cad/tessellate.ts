/**
 * Achatamento (tesselação) de curvas em polilinhas, por TOLERÂNCIA DE CORDA.
 *
 * Existe porque passo fixo é erro de ordem de grandeza: 16 segmentos num furo de
 * R=2 é desperdício, e 16 segmentos num raio de 500 mm dá erro de corda de
 * ~1,2 mm — mais que o kerf inteiro. Aqui o número de segmentos sai da geometria:
 *
 *   Δθ_max = 2·acos(1 − ε/R)   (para ε < R; senão 1 segmento por quadrante)
 *   n      = clamp(ceil(|Δθ| / Δθ_max), 4, 720)
 *
 * ε default = 0,05 mm, abaixo do kerf de qualquer laser — o erro de achatamento
 * fica menor que a espessura do próprio corte, logo não vira erro de preço.
 *
 * Módulo PURO: só `./ir.js` e built-ins. Nada que leia env no topo.
 */

import { arcFromBulge, EPS, type Pt, TAU } from './ir.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Tolerância de corda default, em mm. */
export const TESS_EPS = 0.05;

/** Piso de segmentos por curva: 4 = um por quadrante, o mínimo que ainda fecha área. */
export const TESS_MIN_SEGS = 4;

/** Teto de segmentos por curva: 720 = meio grau. Acima disso é só peso de arquivo. */
export const TESS_MAX_SEGS = 720;

/** Profundidade máxima da bisseção de cúbicas. */
export const TESS_CUBIC_MAX_DEPTH = 16;

/** Profundidade máxima da bisseção de splines (exigência do produto). */
export const TESS_SPLINE_MAX_DEPTH = 12;

/** Teto de pontos por curva achatada — trava de segurança contra curva patológica. */
export const TESS_MAX_POINTS = 4096;

/** Folga da elipse sobre ε (ver `tessEllipse`). */
const ELIPSE_MARGEM = 0.75;

export interface TessOpts {
	/** Tolerância de corda em mm (default `TESS_EPS`). */
	eps?: number;
}

function epsOf(opts?: TessOpts): number {
	const e = opts?.eps;
	// ε <= 0 tesselaria para sempre; 1e-4 mm é 100 nm, muito abaixo de qualquer máquina.
	return typeof e === 'number' && Number.isFinite(e) && e > 0
		? Math.max(e, 1e-4)
		: TESS_EPS;
}

// ---------------------------------------------------------------------------
// Núcleo: quantos segmentos para um arco de raio R e varredura Δθ
// ---------------------------------------------------------------------------

/**
 * Maior ângulo que um único segmento de corda pode varrer sem que a flecha
 * (distância corda↔arco) passe de ε. Derivação: flecha = R·(1 − cos(Δθ/2)),
 * então Δθ = 2·acos(1 − ε/R).
 * Com ε >= R o arco cabe todo dentro da tolerância; aí a forma perde sentido
 * geométrico e usamos 1 segmento por quadrante (o piso visual).
 */
export function maxSweepPerSeg(r: number, eps: number = TESS_EPS): number {
	if (!(r > EPS) || eps >= r) return Math.PI / 2;
	return 2 * Math.acos(1 - eps / r);
}

/** Nº de segmentos para varrer `sweepAbs` (rad, >= 0) num raio `r`, dentro de ε. */
export function segCountForArc(
	r: number,
	sweepAbs: number,
	eps: number = TESS_EPS,
): number {
	const dmax = maxSweepPerSeg(r, eps);
	const n = Math.ceil(Math.abs(sweepAbs) / dmax);
	return Math.min(TESS_MAX_SEGS, Math.max(TESS_MIN_SEGS, n || TESS_MIN_SEGS));
}

/** Flecha real (erro de corda, em mm) de um arco de raio `r` achatado em `n` segmentos. */
export function chordErrorOf(r: number, sweepAbs: number, n: number): number {
	if (n <= 0) return Number.POSITIVE_INFINITY;
	return r * (1 - Math.cos(Math.abs(sweepAbs) / n / 2));
}

// ---------------------------------------------------------------------------
// Arco e círculo
// ---------------------------------------------------------------------------

function ptOnCircle(c: Pt, r: number, ang: number): Pt {
	return { x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) };
}

/**
 * Achata um arco. Devolve os pontos COM as duas extremidades (n+1 pontos),
 * exatamente sobre o arco — o erro fica todo do lado de dentro da corda.
 */
export function tessArc(
	c: Pt,
	r: number,
	a0: number,
	a1: number,
	ccw: boolean,
	opts?: TessOpts,
): Pt[] {
	const eps = epsOf(opts);
	let sweep = (((ccw ? a1 - a0 : a0 - a1) % TAU) + TAU) % TAU;
	if (sweep < EPS) {
		// a0 === a1 é arco degenerado, não volta completa (círculo é `tessCircle`).
		return [ptOnCircle(c, r, a0), ptOnCircle(c, r, a1)];
	}
	if (!ccw) sweep = -sweep;
	const n = segCountForArc(r, Math.abs(sweep), eps);
	const out: Pt[] = [];
	for (let i = 0; i <= n; i++) {
		out.push(ptOnCircle(c, r, a0 + (sweep * i) / n));
	}
	return out;
}

/**
 * Achata um círculo completo. Devolve `n` pontos SEM repetir o primeiro — é uma
 * polilinha FECHADA (`closed: true`), o fechamento é implícito.
 */
export function tessCircle(c: Pt, r: number, opts?: TessOpts): Pt[] {
	const n = segCountForArc(r, TAU, epsOf(opts));
	const out: Pt[] = [];
	for (let i = 0; i < n; i++) out.push(ptOnCircle(c, r, (TAU * i) / n));
	return out;
}

// ---------------------------------------------------------------------------
// Elipse
// ---------------------------------------------------------------------------

/**
 * Achata uma elipse (ou arco de elipse) de semi-eixos `a`/`b` girada de `rot`.
 * `t0`/`t1` são ângulos PARAMÉTRICOS (é o que o DXF guarda), não geométricos.
 *
 * O passo usa o raio de curvatura MÍNIMO, ρ_min = b²/a (nas pontas do eixo
 * maior). É conservador de propósito: a curvatura varia ao longo da elipse e
 * dimensionar pelo trecho mais fechado garante ε em todo o resto. Uma elipse
 * 100×10 tem ρ_min = 1 mm — quem dimensionasse pelo semi-eixo maior erraria a
 * ponta por quase 1 mm.
 */
export function tessEllipse(
	c: Pt,
	a: number,
	b: number,
	rot: number,
	t0: number = 0,
	t1: number = TAU,
	opts?: TessOpts,
): Pt[] {
	const eps = epsOf(opts);
	const at = (t: number): Pt => {
		const cs = Math.cos(rot);
		const sn = Math.sin(rot);
		const x = a * Math.cos(t);
		const y = b * Math.sin(t);
		return { x: c.x + x * cs - y * sn, y: c.y + x * sn + y * cs };
	};
	const major = Math.max(Math.abs(a), Math.abs(b));
	const minor = Math.min(Math.abs(a), Math.abs(b));
	if (major < EPS) return [at(t0), at(t1)];
	// Elipse achatada a zero é um segmento; achatar "curva" ali não faz sentido.
	const rhoMin = minor < EPS ? major : (minor * minor) / major;
	const sweep = t1 - t0;
	if (Math.abs(sweep) < EPS) return [at(t0), at(t1)];
	// ARMADILHA: t é ângulo PARAMÉTRICO, não geométrico. O ângulo de curvatura
	// varrido por dt vale (a/b)·dt na ponta do eixo maior (máximo de κ·|r'|), então
	// o passo em t tem de ser dividido por a/b. Sem esse fator, uma elipse 100×10
	// sairia com 10 segmentos em vez de 100 — facetada em 4 mm.
	// Margem de 25%: a fórmula da flecha vale para curvatura CONSTANTE, e na
	// elipse ela varia DENTRO de cada segmento — medido, o erro estourava ε por
	// ~1% sem essa folga.
	const n = segCountForArc(
		rhoMin,
		(Math.abs(sweep) * major) / Math.max(minor, EPS),
		eps * ELIPSE_MARGEM,
	);
	const out: Pt[] = [];
	for (let i = 0; i <= n; i++) out.push(at(t0 + (sweep * i) / n));
	return out;
}

// ---------------------------------------------------------------------------
// Bézier cúbica
// ---------------------------------------------------------------------------

/** Distância de `p` à RETA que passa por a→b (a==b vira distância ao ponto). */
export function distToChord(p: Pt, a: Pt, b: Pt): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot(dx, dy);
	if (len < EPS) return Math.hypot(p.x - a.x, p.y - a.y);
	return Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / len;
}

function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
	const mt = 1 - t;
	const w0 = mt * mt * mt;
	const w1 = 3 * mt * mt * t;
	const w2 = 3 * mt * t * t;
	const w3 = t * t * t;
	return {
		x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
		y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
	};
}

function mid(a: Pt, b: Pt): Pt {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Achata uma Bézier cúbica por bisseção adaptativa: mede a distância do ponto
 * do meio à corda e, se passar de ε, corta a curva em duas (de Casteljau) e
 * repete. Devolve `[p0, ..., p3]`.
 *
 * A distância dos pontos de CONTROLE à corda entra com metade do peso: existe
 * curva em "S" cujo ponto médio cai exatamente sobre a corda mas que está longe
 * de ser reta — só o teste do meio a aprovaria achatada.
 */
export function tessCubic(
	p0: Pt,
	p1: Pt,
	p2: Pt,
	p3: Pt,
	opts?: TessOpts,
): Pt[] {
	const eps = epsOf(opts);
	const out: Pt[] = [{ x: p0.x, y: p0.y }];
	const rec = (a: Pt, b: Pt, c: Pt, d: Pt, depth: number): void => {
		if (out.length >= TESS_MAX_POINTS) return;
		const m = cubicAt(a, b, c, d, 0.5);
		const err = Math.max(
			distToChord(m, a, d),
			0.5 * Math.max(distToChord(b, a, d), distToChord(c, a, d)),
		);
		if (err <= eps || depth >= TESS_CUBIC_MAX_DEPTH) {
			out.push({ x: d.x, y: d.y });
			return;
		}
		// de Casteljau em t = 0,5.
		const ab = mid(a, b);
		const bc = mid(b, c);
		const cd = mid(c, d);
		const abc = mid(ab, bc);
		const bcd = mid(bc, cd);
		const abcd = mid(abc, bcd);
		rec(a, ab, abc, abcd, depth + 1);
		rec(abcd, bcd, cd, d, depth + 1);
	};
	rec(p0, p1, p2, p3, 0);
	return out;
}

// ---------------------------------------------------------------------------
// B-spline / NURBS (SPLINE do DXF)
// ---------------------------------------------------------------------------

export interface SplineInput {
	/** Pontos de controle (não são pontos da curva, exceto nas pontas de spline clampeada). */
	controlPoints: Pt[];
	/** Grau (DXF grupo 71). Default 3. */
	degree?: number;
	/** Vetor de nós (DXF grupo 40). Gerado clampeado-uniforme quando ausente/inconsistente. */
	knots?: number[];
	/** Pesos (DXF grupo 41). Ausente = todos 1 (spline não-racional). */
	weights?: number[];
	/** Fecha a curva repetindo pontos de controle quando não há vetor de nós válido. */
	closed?: boolean;
}

/** Vetor de nós clampeado uniforme: p+1 zeros, interior 1..n−p, p+1 no fim. */
function clampedKnots(n: number, p: number): number[] {
	const k: number[] = [];
	for (let i = 0; i <= p; i++) k.push(0);
	const interior = n - p;
	for (let i = 1; i <= interior; i++) k.push(i);
	const last = interior + 1;
	for (let i = 0; i <= p; i++) k.push(last);
	return k.map((v) => v / last);
}

function findSpan(t: number, p: number, n: number, knots: number[]): number {
	if (t >= knots[n + 1]) {
		// Último span NÃO degenerado — com nós repetidos no fim, cair em knots[n]
		// daria denominador zero em todo o de Boor.
		let i = n;
		while (i > p && !(knots[i + 1] - knots[i] > EPS)) i--;
		return i;
	}
	if (t <= knots[p]) {
		let i = p;
		while (i < n && !(knots[i + 1] - knots[i] > EPS)) i++;
		return i;
	}
	let lo = p;
	let hi = n + 1;
	let m = (lo + hi) >> 1;
	while (t < knots[m] || t >= knots[m + 1]) {
		if (t < knots[m]) hi = m;
		else lo = m;
		m = (lo + hi) >> 1;
		if (m <= p) return p;
		if (m >= n) return n;
	}
	return m;
}

/**
 * Avalia a curva em `t` por De Boor, em coordenadas homogêneas (é o que faz o
 * peso do NURBS valer: interpolar x·w e w e dividir no fim, nunca x direto).
 */
function deBoor(
	t: number,
	p: number,
	cps: Pt[],
	knots: number[],
	weights?: number[],
): Pt {
	const n = cps.length - 1;
	const span = findSpan(t, p, n, knots);
	const dx: number[] = [];
	const dy: number[] = [];
	const dw: number[] = [];
	for (let j = 0; j <= p; j++) {
		const idx = span - p + j;
		const w = weights?.[idx] ?? 1;
		dx[j] = cps[idx].x * w;
		dy[j] = cps[idx].y * w;
		dw[j] = w;
	}
	for (let r = 1; r <= p; r++) {
		for (let j = p; j >= r; j--) {
			const i = span - p + j;
			const den = knots[i + p - r + 1] - knots[i];
			const al = den > EPS ? (t - knots[i]) / den : 0;
			dx[j] = (1 - al) * dx[j - 1] + al * dx[j];
			dy[j] = (1 - al) * dy[j - 1] + al * dy[j];
			dw[j] = (1 - al) * dw[j - 1] + al * dw[j];
		}
	}
	const w = dw[p];
	const inv = Math.abs(w) > EPS ? 1 / w : 1;
	return { x: dx[p] * inv, y: dy[p] * inv };
}

/**
 * Achata uma B-spline/NURBS. Sai span de nó por span de nó (nó é onde a
 * curvatura pode pular; atravessar um span com bisseção cega mascara o salto) e
 * dentro de cada span faz bisseção adaptativa pela distância à corda.
 * Profundidade máxima 12 e teto de 4096 pontos: spline de campo vem com nós
 * duplicados e derivada infinita, e sem teto isso viraria loop.
 */
export function tessSpline(input: SplineInput, opts?: TessOpts): Pt[] {
	const eps = epsOf(opts);
	let cps = input.controlPoints.map((p) => ({ x: p.x, y: p.y }));
	if (cps.length === 0) return [];
	if (cps.length === 1) return [cps[0]];
	let p = Math.round(input.degree ?? 3);
	if (!Number.isFinite(p) || p < 1) p = 1;
	let knots = input.knots?.filter((v) => Number.isFinite(v));
	let weights = input.weights?.filter((v) => Number.isFinite(v));

	// Fechada sem vetor de nós: repete os p primeiros controles no fim. É a
	// aproximação declarada — CAD de verdade sempre manda os nós.
	if (input.closed && (!knots || knots.length !== cps.length + p + 1)) {
		const wrap = Math.min(p, cps.length);
		const extraW = weights ? weights.slice(0, wrap) : undefined;
		cps = [...cps, ...cps.slice(0, wrap)];
		if (weights && extraW) weights = [...weights, ...extraW];
		knots = undefined;
	}
	if (p > cps.length - 1) p = cps.length - 1;
	const n = cps.length - 1;
	if (!knots || knots.length !== n + p + 2) knots = clampedKnots(n, p);
	if (weights && weights.length !== cps.length) weights = undefined;

	const t0 = knots[p];
	const t1 = knots[n + 1];
	if (!(t1 - t0 > EPS)) return [cps[0], cps[n]];

	const out: Pt[] = [deBoor(t0, p, cps, knots, weights)];
	const rec = (ta: Pt, tb: Pt, a: number, b: number, depth: number): void => {
		if (out.length >= TESS_MAX_POINTS) return;
		const tm = (a + b) / 2;
		const pm = deBoor(tm, p, cps, knots, weights);
		// Dois níveis obrigatórios: span longo pode ter o meio caindo na corda por
		// simetria e passar por reto.
		const flat = depth >= 2 && distToChord(pm, ta, tb) <= eps;
		if (flat || depth >= TESS_SPLINE_MAX_DEPTH) {
			out.push(tb);
			return;
		}
		rec(ta, pm, a, tm, depth + 1);
		rec(pm, tb, tm, b, depth + 1);
	};
	for (let i = p; i <= n; i++) {
		const a = knots[i];
		const b = knots[i + 1];
		if (!(b - a > EPS)) continue;
		if (b <= t0 || a >= t1) continue;
		const sa = Math.max(a, t0);
		const sb = Math.min(b, t1);
		if (!(sb - sa > EPS)) continue;
		rec(
			deBoor(sa, p, cps, knots, weights),
			deBoor(sb, p, cps, knots, weights),
			sa,
			sb,
			0,
		);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Bulge (LWPOLYLINE do DXF)
// ---------------------------------------------------------------------------

/**
 * Achata o trecho de polilinha entre `p1` e `p2` com `bulge`. Devolve
 * `[p1, ..., p2]`; bulge ~ 0 (reta) devolve só as duas pontas.
 */
export function tessBulge(
	p1: Pt,
	p2: Pt,
	bulge: number,
	opts?: TessOpts,
): Pt[] {
	const arc = arcFromBulge(p1, p2, bulge);
	if (!arc)
		return [
			{ x: p1.x, y: p1.y },
			{ x: p2.x, y: p2.y },
		];
	const pts = tessArc(arc.c, arc.r, arc.a0, arc.a1, arc.ccw, opts);
	// As pontas voltam pelos vértices originais: o arco derivado do bulge tem
	// erro de arredondamento no centro, e vértice deslocado abre fenda no contorno.
	pts[0] = { x: p1.x, y: p1.y };
	pts[pts.length - 1] = { x: p2.x, y: p2.y };
	return pts;
}

/**
 * Expande (pts, closed, bulges) numa polilinha só de retas. Usada quando a
 * geometria precisa sair da forma canônica — transformação não-conforme de
 * bloco, por exemplo.
 */
export function tessPolyBulge(
	pts: Pt[],
	closed: boolean,
	bulges?: number[],
	opts?: TessOpts,
): Pt[] {
	const n = pts.length;
	if (n < 2) return pts.map((p) => ({ x: p.x, y: p.y }));
	const out: Pt[] = [{ x: pts[0].x, y: pts[0].y }];
	const last = closed ? n : n - 1;
	for (let i = 0; i < last; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % n];
		const bl = bulges?.[i] ?? 0;
		if (Math.abs(bl) < EPS) {
			out.push({ x: b.x, y: b.y });
			continue;
		}
		const arc = tessBulge(a, b, bl, opts);
		for (let j = 1; j < arc.length; j++) out.push(arc[j]);
	}
	// Fechada: o último ponto repete o primeiro; a IR fecha implicitamente.
	if (closed && out.length > 1) {
		const f = out[0];
		const l = out[out.length - 1];
		if (Math.hypot(l.x - f.x, l.y - f.y) < EPS) out.pop();
	}
	return out;
}
