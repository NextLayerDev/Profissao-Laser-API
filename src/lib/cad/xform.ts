/**
 * Matriz afim 2D e transformação de segmentos da IR. Usada pelos leitores:
 * INSERT do DXF (bloco posicionado/girado/escalado, possivelmente espelhado) e
 * `transform`/inversão de Y do SVG.
 *
 * A regra que evita geometria errada: enquanto a matriz é CONFORME (rotação +
 * escala uniforme, com ou sem espelho) círculo continua círculo e arco continua
 * arco — então a forma canônica é preservada e o comprimento de corte sai exato.
 * Quando NÃO é (escala x ≠ y, cisalhamento), círculo virou elipse: aí tessela-se
 * em coordenadas do bloco e a matriz é aplicada nos PONTOS.
 *
 * Convenção (igual SVG): x' = a·x + c·y + e ; y' = b·x + d·y + f.
 *
 * Módulo PURO: `./ir.js`, `./tessellate.js` e built-ins.
 */

import { arcFromBulge, type CadPath, EPS, type Pt, type Seg } from './ir.js';
import {
	type TessOpts,
	tessArc,
	tessCircle,
	tessPolyBulge,
} from './tessellate.js';

export interface Mat {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

export const MAT_ID: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Composição: aplica `inner` primeiro e `outer` depois. */
export function matMul(outer: Mat, inner: Mat): Mat {
	return {
		a: outer.a * inner.a + outer.c * inner.b,
		b: outer.b * inner.a + outer.d * inner.b,
		c: outer.a * inner.c + outer.c * inner.d,
		d: outer.b * inner.c + outer.d * inner.d,
		e: outer.a * inner.e + outer.c * inner.f + outer.e,
		f: outer.b * inner.e + outer.d * inner.f + outer.f,
	};
}

export function matTranslate(dx: number, dy: number): Mat {
	return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

export function matScale(sx: number, sy: number): Mat {
	return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

export function matRotate(rad: number): Mat {
	const cs = Math.cos(rad);
	const sn = Math.sin(rad);
	return { a: cs, b: sn, c: -sn, d: cs, e: 0, f: 0 };
}

export function applyMat(m: Mat, p: Pt): Pt {
	return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export function matDet(m: Mat): number {
	return m.a * m.d - m.b * m.c;
}

/** Escala linear da matriz conforme: √|det|. Multiplica raio e altura de texto. */
export function matScaleFactor(m: Mat): number {
	return Math.sqrt(Math.abs(matDet(m)));
}

/**
 * Maior alongamento da matriz (maior valor singular da parte linear). É o fator
 * certo para dividir a tolerância de tesselação: com escala 2×1, √|det| = 1,41
 * subestima o esticamento real do eixo X (2×) e a curva sairia facetada além de ε.
 */
export function matMaxStretch(m: Mat): number {
	const e = m.a * m.a + m.b * m.b;
	const f = m.c * m.c + m.d * m.d;
	const g = m.a * m.c + m.b * m.d;
	const meio = (e + f) / 2;
	const raio = Math.sqrt(((e - f) / 2) ** 2 + g * g);
	return Math.sqrt(Math.max(meio + raio, 0));
}

/** Rotação equivalente, em GRAUS (só faz sentido em matriz conforme). */
export function matRotationDeg(m: Mat): number {
	return (Math.atan2(m.b, m.a) * 180) / Math.PI;
}

/**
 * Conforme = preserva ângulos. Vale para rotação+escala uniforme (a=d, b=−c) e
 * para a mesma coisa com espelho (a=−d, b=c). Só nesses casos círculo/arco
 * sobrevivem como círculo/arco.
 */
export function isConformalMat(m: Mat): boolean {
	const s = Math.hypot(m.a, m.b);
	if (!(s > EPS)) return false;
	const tol = 1e-7 * Math.max(1, s);
	const direta = Math.abs(m.a - m.d) < tol && Math.abs(m.b + m.c) < tol;
	const espelhada = Math.abs(m.a + m.d) < tol && Math.abs(m.b - m.c) < tol;
	return direta || espelhada;
}

export function isIdentityMat(m: Mat): boolean {
	return (
		Math.abs(m.a - 1) < 1e-12 &&
		Math.abs(m.b) < 1e-12 &&
		Math.abs(m.c) < 1e-12 &&
		Math.abs(m.d - 1) < 1e-12 &&
		Math.abs(m.e) < 1e-12 &&
		Math.abs(m.f) < 1e-12
	);
}

/**
 * Transforma um segmento por matriz CONFORME, preservando a forma canônica.
 * Espelho (det < 0) inverte o sentido do arco e o sinal do bulge — o arco muda
 * de lado da corda, e é isso que `bulge` codifica.
 */
function transformConformal(seg: Seg, m: Mat): Seg {
	const espelho = matDet(m) < 0;
	const k = matScaleFactor(m);
	switch (seg.k) {
		case 'line':
			return { k: 'line', a: applyMat(m, seg.a), b: applyMat(m, seg.b) };
		case 'circle':
			return { k: 'circle', c: applyMat(m, seg.c), r: seg.r * k };
		case 'arc': {
			const c = applyMat(m, seg.c);
			const p0 = applyMat(m, {
				x: seg.c.x + seg.r * Math.cos(seg.a0),
				y: seg.c.y + seg.r * Math.sin(seg.a0),
			});
			const p1 = applyMat(m, {
				x: seg.c.x + seg.r * Math.cos(seg.a1),
				y: seg.c.y + seg.r * Math.sin(seg.a1),
			});
			return {
				k: 'arc',
				c,
				r: seg.r * k,
				a0: Math.atan2(p0.y - c.y, p0.x - c.x),
				a1: Math.atan2(p1.y - c.y, p1.x - c.x),
				ccw: espelho ? !seg.ccw : seg.ccw,
			};
		}
		case 'poly':
			return {
				k: 'poly',
				pts: seg.pts.map((p) => applyMat(m, p)),
				closed: seg.closed,
				...(seg.bulges
					? { bulges: seg.bulges.map((b) => (espelho ? -b : b)) }
					: {}),
			};
		case 'text':
			return {
				...seg,
				at: applyMat(m, seg.at),
				h: seg.h * k,
				rot:
					(seg.rot ?? 0) + (espelho ? -matRotationDeg(m) : matRotationDeg(m)),
			};
	}
}

/**
 * Achata o segmento em polilinha nas SUAS coordenadas (sem matriz).
 * `null` para texto — texto não vira geometria aqui (vira diagnóstico).
 */
export function segToPoly(
	seg: Seg,
	opts?: TessOpts,
): { pts: Pt[]; closed: boolean } | null {
	switch (seg.k) {
		case 'line':
			return { pts: [seg.a, seg.b], closed: false };
		case 'circle':
			return { pts: tessCircle(seg.c, seg.r, opts), closed: true };
		case 'arc':
			return {
				pts: tessArc(seg.c, seg.r, seg.a0, seg.a1, seg.ccw, opts),
				closed: false,
			};
		case 'poly':
			return {
				pts: tessPolyBulge(seg.pts, seg.closed, seg.bulges, opts),
				closed: seg.closed,
			};
		case 'text':
			return null;
	}
}

/**
 * Transforma um segmento por matriz qualquer. Conforme → forma canônica
 * preservada; não-conforme → achatado em `poly` e os PONTOS transformados
 * (é assim que CIRCLE dentro de bloco com escala 2×1 sai elipse de verdade).
 *
 * `eps` da tesselação é medido em unidades do BLOCO; passe já dividido pela
 * escala se a matriz aumenta muito o desenho.
 */
export function transformSeg(seg: Seg, m: Mat, opts?: TessOpts): Seg {
	if (isIdentityMat(m)) return seg;
	if (isConformalMat(m)) return transformConformal(seg, m);
	if (seg.k === 'text') {
		// Texto sob escala não-uniforme: mantém como texto (é diagnóstico, não corte).
		return { ...seg, at: applyMat(m, seg.at), h: seg.h * matScaleFactor(m) };
	}
	const flat = segToPoly(seg, opts);
	if (!flat) return seg;
	return {
		k: 'poly',
		pts: flat.pts.map((p) => applyMat(m, p)),
		closed: flat.closed,
	};
}

export function transformPath(path: CadPath, m: Mat, opts?: TessOpts): CadPath {
	return { ...path, seg: transformSeg(path.seg, m, opts) };
}

/** Escala uniforme de um segmento (conversão de unidade), sem rotação nem translação. */
export function scaleSeg(seg: Seg, f: number): Seg {
	if (Math.abs(f - 1) < 1e-15) return seg;
	return transformConformal(seg, matScale(f, f));
}

/** Translada um segmento — usado para levar a bbox à origem. */
export function translateSeg(seg: Seg, dx: number, dy: number): Seg {
	if (Math.abs(dx) < 1e-15 && Math.abs(dy) < 1e-15) return seg;
	return transformConformal(seg, matTranslate(dx, dy));
}

/**
 * Área com sinal (fórmula do shoelace) da polilinha equivalente do segmento —
 * o único jeito honesto de saber se um contorno fechado é externo ou furo.
 * Não usa a IA para nada disso: é conta fechada.
 */
export function signedArea(seg: Seg, opts?: TessOpts): number {
	const flat = segToPoly(seg, opts);
	if (!flat || flat.pts.length < 3) return 0;
	const pts = flat.pts;
	let acc = 0;
	for (let i = 0; i < pts.length; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % pts.length];
		acc += a.x * b.y - b.x * a.y;
	}
	return acc / 2;
}

/** Faz `arcFromBulge` visível para quem só importa este módulo. */
export { arcFromBulge };
