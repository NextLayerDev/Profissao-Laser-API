import { describe, expect, it } from 'vitest';
import {
	arcFromBulge,
	BULGE_90,
	bboxOf as bbox,
	bboxOf,
	circle,
	computeStats,
	type Part,
	polyline,
	rect,
	rotatePath90,
	roundRect,
	segLength,
	slot,
	text,
	translatePath,
} from '@/lib/cad/ir.js';
import {
	assertJoint,
	crossLap,
	edge,
	fingerCount,
	fingerGeometry,
	holeDiameter,
	inner,
	outer,
	validateJoint,
} from '@/lib/cad/kerf.js';

const TOL = 1e-9;

describe('compensação de kerf', () => {
	it('externo cresce k, interno encolhe k, aresta anda k/2', () => {
		expect(outer(50, 0.15)).toBeCloseTo(50.15, 12);
		expect(inner(50, 0.15)).toBeCloseTo(49.85, 12);
		expect(edge(50, 0.15)).toBeCloseTo(50.075, 12);
	});

	it('furo desenhado menor que o nominal (o feixe alarga o vazio)', () => {
		expect(holeDiameter(5, 0.2)).toBeCloseTo(4.8, 12);
		// Round-trip: o furo que sai da máquina é o nominal.
		expect(holeDiameter(5, 0.2) + 0.2).toBeCloseTo(5, 12);
	});
});

describe('finger joint — dente e fenda montam com a folga exata', () => {
	// 12 combinações de (t, k, c) cobrindo MDF fino a acrílico grosso, kerf de
	// laser CO2 (0,1–0,3) e folga de interferência a folgada.
	const combos = [
		{ t: 3, k: 0.1, c: 0.05, L: 120 },
		{ t: 3, k: 0.15, c: 0.1, L: 90 },
		{ t: 3, k: 0.2, c: 0, L: 200 },
		{ t: 4, k: 0.12, c: 0.15, L: 150 },
		{ t: 5, k: 0.18, c: 0.2, L: 180 },
		{ t: 6, k: 0.25, c: 0.1, L: 240 },
		{ t: 6, k: 0.3, c: -0.05, L: 75 },
		{ t: 8, k: 0.22, c: 0.3, L: 320 },
		{ t: 9, k: 0.1, c: 0.05, L: 137.5 },
		{ t: 10, k: 0.35, c: 0.4, L: 400 },
		{ t: 12, k: 0.4, c: -0.1, L: 260 },
		{ t: 15, k: 0.5, c: 0.25, L: 333 },
	];

	for (const { t, k, c, L } of combos) {
		it(`t=${t} k=${k} c=${c} L=${L}`, () => {
			const g = fingerGeometry({ L, t, tOposta: t, k, c });

			// O contrato do encaixe: depois de cortado, fenda − dente = folga.
			expect(
				Math.abs(g.fendaLarguraFinal - g.denteLarguraFinal - c),
			).toBeLessThan(TOL);

			// E as larguras DESENHADAS diferem de c − 2k (é o que embute o kerf).
			expect(
				Math.abs(g.fendaLargura - g.denteLargura - (c - 2 * k)),
			).toBeLessThan(TOL);

			// Dente atravessa a chapa oposta e fica rente depois do corte.
			expect(Math.abs(g.denteAltura - k - t)).toBeLessThan(TOL);

			// Passo real fecha a aresta sem sobra.
			expect(Math.abs(g.p * g.n - L)).toBeLessThan(1e-9);

			// Ímpar → dente nas duas pontas.
			expect(g.n % 2).toBe(1);
			expect(g.denteLargura).toBeGreaterThan(0);
		});
	}

	it('nº de dentes é sempre ímpar, para qualquer comprimento e alvo', () => {
		for (let L = 1; L <= 600; L += 7) {
			for (const alvo of [3, 6, 8, 10, 12, 20, 25, 40]) {
				const n = fingerCount(L, alvo);
				expect(n % 2).toBe(1);
				expect(n).toBeGreaterThanOrEqual(1);
			}
		}
	});

	it('dente-alvo é limitado à faixa [6, 25]', () => {
		// Alvo minúsculo é elevado a 6 → não pode dar mais dentes que L/(2·6).
		expect(fingerCount(100, 0.5)).toBe(fingerCount(100, 6));
		// Alvo gigante é reduzido a 25.
		expect(fingerCount(100, 999)).toBe(fingerCount(100, 25));
		expect(
			fingerGeometry({ L: 100, t: 3, tOposta: 3, k: 0.1, c: 0.1, alvo: 1 })
				.alvoUsado,
		).toBe(6);
		expect(
			fingerGeometry({ L: 100, t: 3, tOposta: 3, k: 0.1, c: 0.1, alvo: 99 })
				.alvoUsado,
		).toBe(25);
	});

	it('alvo default é max(3t, 8)', () => {
		// t=1 → 3t=3, vence 8; e o clamp ainda sobe para 6... 8 > 6, então fica 8.
		expect(
			fingerGeometry({ L: 200, t: 1, tOposta: 1, k: 0.1, c: 0.1 }).alvoUsado,
		).toBe(8);
		// t=5 → 3t=15.
		expect(
			fingerGeometry({ L: 200, t: 5, tOposta: 5, k: 0.1, c: 0.1 }).alvoUsado,
		).toBe(15);
	});
});

describe('cross lap', () => {
	it('rasgo final tem a espessura da outra chapa mais a folga, e meia altura', () => {
		const r = crossLap({ tOutra: 6, k: 0.2, c: 0.1, H: 80 });
		expect(Math.abs(r.slotLargFinal - (6 + 0.1))).toBeLessThan(TOL);
		expect(Math.abs(r.slotProfFinal - 40)).toBeLessThan(TOL);
		// Desenhado é menor: o vazio cresce sozinho ao ser cortado.
		expect(r.slotLarg).toBeLessThan(r.slotLargFinal);
		expect(r.slotProf).toBeLessThan(r.slotProfFinal);
	});
});

describe('invariantes do encaixe', () => {
	it('kerf maior ou igual à espessura é fatal', () => {
		const v = validateJoint({ t: 0.3, k: 0.3, c: 0.1 });
		expect(v.fatal.length).toBeGreaterThan(0);
		expect(v.fatal.join(' ')).toMatch(/kerf/i);
		expect(() => assertJoint({ t: 0.3, k: 0.3, c: 0.1 })).toThrowError(/kerf/i);
	});

	it('dente de largura zero ou negativa é fatal', () => {
		// p pequeno + folga enorme → dente somem.
		const v = validateJoint({ t: 3, k: 0.1, c: 5, p: 2 });
		expect(v.fatal.some((m) => /dente/i.test(m))).toBe(true);
	});

	it('furo que some com o kerf é fatal', () => {
		const v = validateJoint({ t: 3, k: 0.3, c: 0.1, furos: [0.6] });
		expect(v.fatal.some((m) => /furo/i.test(m))).toBe(true);
		// Furo folgado não reclama.
		expect(
			validateJoint({ t: 3, k: 0.3, c: 0.1, furos: [5] }).fatal,
		).toHaveLength(0);
	});

	it('passo curto e folga fora da faixa viram aviso, não erro', () => {
		const v = validateJoint({ t: 6, k: 0.2, c: 0.9, p: 3 });
		expect(v.fatal).toHaveLength(0);
		expect(v.warnings.length).toBeGreaterThanOrEqual(2);
		expect(v.warnings.join(' ')).toMatch(/passo/i);
		expect(v.warnings.join(' ')).toMatch(/folga/i);
	});

	it('encaixe saudável não gera nem erro nem aviso', () => {
		const g = fingerGeometry({ L: 150, t: 3, tOposta: 3, k: 0.15, c: 0.1 });
		const v = validateJoint({
			t: 3,
			k: 0.15,
			c: 0.1,
			p: g.p,
			n: g.n,
			L: 150,
			furos: [4],
		});
		expect(v.fatal).toHaveLength(0);
		expect(v.warnings).toHaveLength(0);
	});
});

describe('bboxOf — o teste do bojo', () => {
	it('círculo dá a caixa do diâmetro inteiro', () => {
		const b = bbox([circle({ x: 5, y: 5 }, 3, 'CORTE')]);
		expect(b.minX).toBeCloseTo(2, 12);
		expect(b.minY).toBeCloseTo(2, 12);
		expect(b.maxX).toBeCloseTo(8, 12);
		expect(b.maxY).toBeCloseTo(8, 12);
		expect(b.w).toBeCloseTo(6, 12);
		expect(b.h).toBeCloseTo(6, 12);
	});

	it('arco de 90° no primeiro quadrante: caixa é o quadrado do raio', () => {
		const b = bbox([
			{
				layer: 'CORTE',
				seg: {
					k: 'arc',
					c: { x: 0, y: 0 },
					r: 10,
					a0: 0,
					a1: Math.PI / 2,
					ccw: true,
				},
			},
		]);
		expect(b.minX).toBeCloseTo(0, 12);
		expect(b.minY).toBeCloseTo(0, 12);
		expect(b.maxX).toBeCloseTo(10, 12);
		expect(b.maxY).toBeCloseTo(10, 12);
	});

	it('arco de 90° cruzando 0° estufa até o raio (bojo além da corda)', () => {
		// De −45° a +45°: as duas pontas estão em x = 7,071, mas o arco chega a 10.
		const b = bbox([
			{
				layer: 'CORTE',
				seg: {
					k: 'arc',
					c: { x: 0, y: 0 },
					r: 10,
					a0: -Math.PI / 4,
					a1: Math.PI / 4,
					ccw: true,
				},
			},
		]);
		expect(b.maxX).toBeCloseTo(10, 12);
		expect(b.minX).toBeCloseTo(Math.SQRT1_2 * 10, 12);
		expect(b.maxY).toBeCloseTo(Math.SQRT1_2 * 10, 12);
		expect(b.minY).toBeCloseTo(-Math.SQRT1_2 * 10, 12);
	});

	it('arco de 270° cobre três cardeais', () => {
		const b = bbox([
			{
				layer: 'CORTE',
				seg: {
					k: 'arc',
					c: { x: 0, y: 0 },
					r: 5,
					a0: 0,
					a1: -Math.PI / 2,
					ccw: true,
				},
			},
		]);
		expect(b.minX).toBeCloseTo(-5, 12);
		expect(b.maxX).toBeCloseTo(5, 12);
		expect(b.maxY).toBeCloseTo(5, 12);
		expect(b.minY).toBeCloseTo(-5, 12);
	});

	it('retângulo arredondado tem exatamente a caixa do retângulo reto', () => {
		const a = bbox([rect(10, 20, 100, 60, 'CORTE')]);
		const r = bbox([roundRect(10, 20, 100, 60, 8, 'CORTE')]);
		expect(r.minX).toBeCloseTo(a.minX, 9);
		expect(r.minY).toBeCloseTo(a.minY, 9);
		expect(r.maxX).toBeCloseTo(a.maxX, 9);
		expect(r.maxY).toBeCloseTo(a.maxY, 9);
	});

	it('rasgo horizontal e vertical ocupam a caixa pedida', () => {
		const h = bbox([slot(0, 0, 40, 6, 'CORTE')]);
		expect(h.w).toBeCloseTo(40, 9);
		expect(h.h).toBeCloseTo(6, 9);
		const v = bbox([slot(3, 7, 6, 40, 'CORTE')]);
		expect(v.w).toBeCloseTo(6, 9);
		expect(v.h).toBeCloseTo(40, 9);
		expect(v.minX).toBeCloseTo(3, 9);
		expect(v.minY).toBeCloseTo(7, 9);
	});

	it('lista vazia devolve caixa zerada em vez de Infinity', () => {
		expect(bboxOf([])).toEqual({
			minX: 0,
			minY: 0,
			maxX: 0,
			maxY: 0,
			w: 0,
			h: 0,
		});
	});
});

describe('bulge', () => {
	it('canto de 90° reconstrói um arco de raio r e centro no canto interno', () => {
		// De (10,0) a (0,10) com bulge de 90° CCW → círculo unitário escalado em 10.
		const arc = arcFromBulge({ x: 10, y: 0 }, { x: 0, y: 10 }, BULGE_90);
		expect(arc).not.toBeNull();
		if (!arc) return;
		expect(arc.r).toBeCloseTo(10, 9);
		expect(arc.c.x).toBeCloseTo(0, 9);
		expect(arc.c.y).toBeCloseTo(0, 9);
		expect(arc.ccw).toBe(true);
	});

	it('bulge 1 é um semicírculo', () => {
		const arc = arcFromBulge({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
		expect(arc?.r).toBeCloseTo(5, 9);
		expect(arc?.c.x).toBeCloseTo(5, 9);
		expect(arc?.c.y).toBeCloseTo(0, 9);
	});

	it('bulge 0 e vértices coincidentes não viram arco', () => {
		expect(arcFromBulge({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toBeNull();
		expect(arcFromBulge({ x: 0, y: 0 }, { x: 0, y: 0 }, 1)).toBeNull();
	});
});

describe('segLength', () => {
	it('círculo, reta e arco', () => {
		expect(segLength({ k: 'circle', c: { x: 0, y: 0 }, r: 10 })).toBeCloseTo(
			2 * Math.PI * 10,
			9,
		);
		expect(
			segLength({ k: 'line', a: { x: 0, y: 0 }, b: { x: 3, y: 4 } }),
		).toBeCloseTo(5, 12);
		expect(
			segLength({
				k: 'arc',
				c: { x: 0, y: 0 },
				r: 10,
				a0: 0,
				a1: Math.PI / 2,
				ccw: true,
			}),
		).toBeCloseTo((Math.PI / 2) * 10, 9);
	});

	it('polilinha fechada soma o perímetro; com bulge soma os arcos', () => {
		expect(segLength(rect(0, 0, 10, 20, 'CORTE').seg)).toBeCloseTo(60, 9);
		// Rasgo 40×6: dois retos de 34 + um círculo de raio 3.
		expect(segLength(slot(0, 0, 40, 6, 'CORTE').seg)).toBeCloseTo(
			2 * 34 + 2 * Math.PI * 3,
			9,
		);
		// Retângulo arredondado: perímetro reto menos os cantos vivos, mais o círculo.
		expect(segLength(roundRect(0, 0, 100, 60, 10, 'CORTE').seg)).toBeCloseTo(
			2 * 80 + 2 * 40 + 2 * Math.PI * 10,
			9,
		);
	});

	it('texto não entra na conta de percurso', () => {
		expect(
			segLength(text({ x: 0, y: 0 }, 'PROFISSAO LASER', 5, 'GRAVACAO').seg),
		).toBe(0);
	});
});

describe('transformações', () => {
	it('translate desloca a caixa sem mudar o tamanho', () => {
		const p = roundRect(0, 0, 40, 20, 5, 'CORTE');
		const b = bbox([translatePath(p, 100, -30)]);
		expect(b.minX).toBeCloseTo(100, 9);
		expect(b.minY).toBeCloseTo(-30, 9);
		expect(b.w).toBeCloseTo(40, 9);
		expect(b.h).toBeCloseTo(20, 9);
	});

	it('rotate90 troca w por h e mantém a peça no primeiro quadrante', () => {
		const paths = [
			rect(0, 0, 40, 20, 'CORTE'),
			circle({ x: 5, y: 5 }, 2, 'CORTE'),
			slot(10, 8, 20, 4, 'GRAVACAO'),
		];
		const antes = bbox(paths);
		const depois = bbox(paths.map((p) => rotatePath90(p, antes.w, antes.h)));
		expect(depois.minX).toBeCloseTo(0, 9);
		expect(depois.minY).toBeCloseTo(0, 9);
		expect(depois.w).toBeCloseTo(antes.h, 9);
		expect(depois.h).toBeCloseTo(antes.w, 9);
	});

	it('rotate90 preserva o comprimento de corte (rotação é rígida)', () => {
		const p = roundRect(0, 0, 40, 20, 5, 'CORTE');
		expect(segLength(rotatePath90(p, 40, 20).seg)).toBeCloseTo(
			segLength(p.seg),
			9,
		);
	});

	it('rotate90 quatro vezes volta ao original', () => {
		const p = polyline(
			[
				{ x: 2, y: 3 },
				{ x: 12, y: 3 },
				{ x: 12, y: 9 },
			],
			true,
			'CORTE',
		);
		let cur = p;
		// Alterna as dimensões da caixa a cada giro, como faz o nesting.
		for (const h of [20, 20, 20, 20]) cur = rotatePath90(cur, 20, h);
		const a = bbox([p]);
		const b = bbox([cur]);
		expect(b.minX).toBeCloseTo(a.minX, 9);
		expect(b.minY).toBeCloseTo(a.minY, 9);
	});
});

describe('computeStats', () => {
	const mkPart = (over: Partial<Part> = {}): Part => ({
		id: 'p1',
		label: 'Lateral',
		thickness: 3,
		material: 'MDF',
		qty: 1,
		bbox: { w: 100, h: 50 },
		paths: [
			rect(0, 0, 100, 50, 'CORTE'), // contorno: 1 furo de entrada, 300 mm
			circle({ x: 20, y: 25 }, 5, 'CORTE'), // furo: mais 1 entrada
			circle({ x: 80, y: 25 }, 5, 'CORTE'), // furo: mais 1 entrada
			rect(40, 20, 20, 10, 'GRAVACAO'), // 60 mm de gravação
			rect(0, 0, 100, 50, 'REFERENCIA'), // não vai para a máquina
		],
		...over,
	});

	it('soma corte, gravação, furos e área — multiplicados pela quantidade', () => {
		const s = computeStats([mkPart({ qty: 3 })]);
		expect(s.partCount).toBe(3);
		expect(s.pierces).toBe(9);
		expect(s.cutLengthMm).toBeCloseTo((300 + 2 * 2 * Math.PI * 5) * 3, 9);
		expect(s.engraveLengthMm).toBeCloseTo(60 * 3, 9);
		expect(s.areaMm2).toBeCloseTo(100 * 50 * 3, 9);
	});

	it('layer REFERENCIA é ignorada por completo', () => {
		const semRef = mkPart({
			paths: mkPart().paths.filter((p) => p.layer !== 'REFERENCIA'),
		});
		expect(computeStats([semRef])).toEqual(computeStats([mkPart()]));
	});

	it('MARCACAO e DOBRA contam como gravação', () => {
		const p = mkPart({
			paths: [rect(0, 0, 10, 10, 'MARCACAO'), rect(0, 0, 10, 10, 'DOBRA')],
		});
		const s = computeStats([p]);
		expect(s.engraveLengthMm).toBeCloseTo(80, 9);
		expect(s.cutLengthMm).toBe(0);
		expect(s.pierces).toBe(0);
	});

	it('qty zero não entra na conta', () => {
		expect(computeStats([mkPart({ qty: 0 })])).toEqual({
			partCount: 0,
			cutLengthMm: 0,
			engraveLengthMm: 0,
			pierces: 0,
			areaMm2: 0,
		});
	});
});
