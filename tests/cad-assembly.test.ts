import { describe, expect, it } from 'vitest';
import {
	type Assembly,
	type AssemblyPart,
	sketchToAssembly,
	TOL_CORDA_MM,
} from '@/lib/cad/assembly.js';
import { buildBbq } from '@/lib/cad/generators/bbq.js';
import { buildBox } from '@/lib/cad/generators/box.js';
import {
	BULGE_90,
	bboxOf,
	type CadPath,
	circle,
	computeStats,
	type Part,
	polyline,
	rect,
	type Sketch2D,
} from '@/lib/cad/ir.js';

/** Empacota caminhos soltos num `Sketch2D` mínimo, do jeito que os geradores fazem. */
function sketchDe(pecas: Array<{ id: string; paths: CadPath[] }>): Sketch2D {
	const parts: Part[] = pecas.map((p) => {
		const bb = bboxOf(p.paths);
		return {
			id: p.id,
			label: p.id,
			thickness: 3,
			material: 'MDF',
			paths: p.paths,
			bbox: { w: bb.w, h: bb.h },
			qty: 1,
		};
	});
	return {
		units: 'mm',
		schema: 1,
		parts,
		meta: {
			generator: 'test',
			params: {},
			kerf: 0,
			clearance: 0,
			warnings: [],
			stats: computeStats(parts),
		},
	};
}

function area(ring: [number, number][]): number {
	let s = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
	}
	return s / 2;
}

function peca(asm: Assembly, id: string): AssemblyPart {
	const p = asm.parts.find((x) => x.id === id);
	if (!p) throw new Error(`peça "${id}" ausente na montagem`);
	return p;
}

describe('sketchToAssembly — caixa real', () => {
	it('converte toda peça da caixa num contorno fechado e orientado', () => {
		const sk = buildBox({
			largura: 200,
			profundidade: 120,
			altura: 80,
			espessura: 3,
		});
		const asm = sketchToAssembly(sk);

		expect(sk.parts.length).toBeGreaterThanOrEqual(5);
		expect(asm.parts).toHaveLength(sk.parts.length);
		expect(asm.units).toBe('mm');

		for (const p of asm.parts) {
			expect(p.outline.length).toBeGreaterThanOrEqual(3);
			// Fechamento é implícito: repetir o primeiro ponto no fim quebraria o
			// `ExtrudeGeometry` (aresta de comprimento zero vira normal NaN).
			const primeiro = p.outline[0];
			const ultimo = p.outline[p.outline.length - 1];
			expect(
				Math.hypot(primeiro[0] - ultimo[0], primeiro[1] - ultimo[1]),
			).toBeGreaterThan(1e-6);
			// Contorno externo sempre anti-horário.
			expect(area(p.outline)).toBeGreaterThan(0);
			expect(p.thickness).toBe(3);
		}

		// A caixa de 200×120×80 externos tem que aparecer inteira na bbox 3D.
		expect(asm.bbox.min[0]).toBeCloseTo(0, 6);
		expect(asm.bbox.max[0]).toBeCloseTo(206, 6);
		expect(asm.bbox.max[1]).toBeCloseTo(126, 6);
		expect(asm.bbox.max[2]).toBeCloseTo(86, 6);
	});

	it('lê o rasgo da tampa deslizante como furo da traseira', () => {
		const sk = buildBox({
			largura: 200,
			profundidade: 120,
			altura: 80,
			espessura: 3,
			tampa: 'deslizante',
		});
		const tras = peca(sketchToAssembly(sk), 'tras');
		expect(tras.holes).toHaveLength(1);
		// Furo em sentido horário (convenção do THREE.Shape.holes).
		expect(area(tras.holes[0])).toBeLessThan(0);
	});
});

describe('sketchToAssembly — furos e camadas', () => {
	it('separa contorno externo de furo e ignora gravura', () => {
		const sk = sketchDe([
			{
				id: 'placa',
				paths: [
					rect(0, 0, 100, 60, 'CORTE'),
					circle({ x: 30, y: 30 }, 8, 'CORTE'),
					// Gravura NÃO atravessa a chapa: não pode virar furo.
					circle({ x: 70, y: 30 }, 8, 'GRAVACAO'),
				],
			},
		]);
		const p = peca(sketchToAssembly(sk), 'placa');

		expect(p.outline).toHaveLength(4);
		expect(p.holes).toHaveLength(1);
		// Polígono INSCRITO: área sempre um pouco menor que a do círculo, e a
		// tolerância de corda garante que a perda fique abaixo de 1%.
		const areaFuro = Math.abs(area(p.holes[0]));
		expect(areaFuro).toBeLessThan(Math.PI * 64);
		expect(areaFuro).toBeGreaterThan(Math.PI * 64 * 0.99);
		expect(area(p.outline)).toBeCloseTo(6000, 6);
	});

	it('enfileira lado a lado as peças sem pose', () => {
		const sk = sketchDe([
			{ id: 'a', paths: [rect(0, 0, 100, 60, 'CORTE')] },
			{ id: 'b', paths: [rect(0, 0, 40, 40, 'CORTE')] },
		]);
		const asm = sketchToAssembly(sk);
		const a = peca(asm, 'a');
		const b = peca(asm, 'b');

		expect(a.pose.pos[0]).toBe(0);
		// À direita da primeira, sem sobreposição.
		expect(b.pose.pos[0]).toBeGreaterThanOrEqual(100);
		expect(a.pose.rot).toEqual([0, 0, 0]);
	});
});

describe('sketchToAssembly — achatamento de arco', () => {
	it('respeita a tolerância de corda num arco de 90° com r = 10', () => {
		const R = 10;
		// Setor de 90°: canto reto na origem e o arco de (10,0) a (0,10).
		const sk = sketchDe([
			{
				id: 'setor',
				paths: [
					polyline(
						[
							{ x: 0, y: 0 },
							{ x: R, y: 0 },
							{ x: 0, y: R },
						],
						true,
						'CORTE',
						[0, BULGE_90, 0],
					),
				],
			},
		]);
		const outline = peca(sketchToAssembly(sk), 'setor').outline;

		// Pontos do arco: os que caem sobre o círculo de raio 10 centrado na origem.
		const noArco = outline.map(
			([x, y]) => Math.abs(Math.hypot(x, y) - R) < 1e-3,
		);
		const indices = noArco.flatMap((v, i) => (v ? [i] : []));
		expect(indices.length).toBeGreaterThanOrEqual(3);

		// Desvio REAL: flecha de cada corda (distância do meio da corda ao arco).
		let desvioMax = 0;
		for (const i of indices) {
			const j = (i + 1) % outline.length;
			if (!noArco[j]) continue;
			const mx = (outline[i][0] + outline[j][0]) / 2;
			const my = (outline[i][1] + outline[j][1]) / 2;
			desvioMax = Math.max(desvioMax, R - Math.hypot(mx, my));
		}

		expect(desvioMax).toBeGreaterThan(0);
		expect(desvioMax).toBeLessThanOrEqual(TOL_CORDA_MM);
	});
});

describe('instâncias (`qty` × `poses`)', () => {
	const quadrado = (): CadPath[] => [
		polyline(
			[
				{ x: 0, y: 0 },
				{ x: 40, y: 0 },
				{ x: 40, y: 20 },
				{ x: 0, y: 20 },
			],
			true,
			'CORTE',
		),
	];

	function peca(qty: number, poses?: Part['poses']): Sketch2D {
		const paths = quadrado();
		const bb = bboxOf(paths);
		const part: Part = {
			id: 'pe',
			label: 'Pé',
			thickness: 2,
			material: 'aco_carbono',
			paths,
			bbox: { w: bb.w, h: bb.h },
			qty,
			pose: { pos: [0, 0, 0], rot: [0, 0, 0] },
			...(poses ? { poses } : {}),
		};
		return {
			units: 'mm',
			schema: 1,
			parts: [part],
			meta: {
				generator: 'teste',
				params: {},
				kerf: 0.2,
				clearance: 0.15,
				warnings: [],
				stats: computeStats([part]),
			},
		};
	}

	it('`poses` vira um corpo por instância, com id único', () => {
		const a = sketchToAssembly(
			peca(2, [
				{ pos: [0, 0, 0], rot: [0, 0, 0] },
				{ pos: [200, 0, 0], rot: [0, 0, 0] },
			]),
		);
		expect(a.parts.map((p) => p.id)).toEqual(['pe', 'pe#2']);
		expect(a.parts[1].pose.pos[0]).toBe(200);
		// A 2ª instância entra na caixa envolvente — era o sintoma original: a
		// montagem media a churrasqueira como se ela tivesse um pé só.
		expect(a.bbox.max[0]).toBe(240);
	});

	it('`qty` sem `poses` NÃO multiplica: posição ninguém inventa', () => {
		const a = sketchToAssembly(peca(2));
		expect(a.parts).toHaveLength(1);
		expect(a.parts[0].id).toBe('pe');
	});
});

describe('churrasqueira: a montagem tem tantos corpos quanto peças a cortar', () => {
	it('os dois pés de chapa dobrada aparecem, cada um no seu lugar', () => {
		const sk = buildBbq({
			pessoas: 20,
			profundidade: 200,
			espessura: 2,
			construcao: 'dobrada',
			pes: 'chapa_dobrada',
		});
		const a = sketchToAssembly(sk);
		expect(a.parts).toHaveLength(sk.meta.stats.partCount);
		const pes = a.parts.filter((p) => p.id.startsWith('pe'));
		expect(pes).toHaveLength(2);
		// 20% e 80% do comprimento: pés distintos, não duas cópias no mesmo ponto.
		expect(pes[0].pose.pos[0]).not.toBeCloseTo(pes[1].pose.pos[0], 3);
	});
});
