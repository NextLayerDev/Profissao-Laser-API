import { describe, expect, it } from 'vitest';
import { circle, type Part, rect, roundRect } from '@/lib/cad/ir.js';
import {
	GAP_MINIMO,
	gapFromKerf,
	MARGEM_PADRAO,
	nestParts,
	partArea,
} from '@/lib/cad/nest.js';

function peca(
	id: string,
	w: number,
	h: number,
	qty = 1,
	paths = [rect(0, 0, w, h, 'CORTE')],
): Part {
	return {
		id,
		label: id,
		thickness: 3,
		material: 'MDF',
		paths,
		bbox: { w, h },
		qty,
	};
}

/** Footprint real de um placement (rot 90 troca os lados). */
function footprint(p: Part, rot: 0 | 90): { w: number; h: number } {
	return rot === 0
		? { w: p.bbox.w, h: p.bbox.h }
		: { w: p.bbox.h, h: p.bbox.w };
}

describe('gapFromKerf', () => {
	it('respeita o piso de 1,5 mm com kerf pequeno', () => {
		expect(gapFromKerf(0)).toBe(GAP_MINIMO);
		expect(gapFromKerf(0.2)).toBe(GAP_MINIMO);
	});

	it('vira 2× kerf quando o kerf manda', () => {
		expect(gapFromKerf(1)).toBe(2);
		expect(gapFromKerf(0.9)).toBeCloseTo(1.8, 9);
	});
});

describe('partArea', () => {
	it('usa o contorno real, não a bbox', () => {
		const disco = peca('disco', 100, 100, 1, [
			circle({ x: 50, y: 50 }, 50, 'CORTE'),
		]);
		expect(partArea(disco, 100, 100)).toBeCloseTo(Math.PI * 2500, 6);
	});

	it('não desconta furos — o vazio interno segue sendo chapa reservada', () => {
		const placa = peca('placa', 100, 100, 1, [
			rect(0, 0, 100, 100, 'CORTE'),
			circle({ x: 50, y: 50 }, 20, 'CORTE'),
		]);
		expect(partArea(placa, 100, 100)).toBeCloseTo(10000, 6);
	});

	it('conta o bojo dos cantos arredondados (área < retângulo, > sem os arcos)', () => {
		const r = peca('rr', 100, 60, 1, [roundRect(0, 0, 100, 60, 10, 'CORTE')]);
		// 100×60 menos os 4 quartos de círculo que faltam nos cantos.
		const esperado = 100 * 60 - (4 - Math.PI) * 10 * 10;
		expect(partArea(r, 100, 60)).toBeCloseTo(esperado, 6);
	});

	it('cai na bbox quando não há contorno fechado de CORTE', () => {
		const solto = peca('solto', 40, 20, 1, [
			{
				layer: 'CORTE',
				seg: { k: 'line', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } },
			},
		]);
		expect(partArea(solto, 40, 20)).toBe(800);
	});
});

describe('nestParts — invariantes de posicionamento', () => {
	const partes = [
		peca('a', 120, 80, 3),
		peca('b', 60, 60, 5),
		peca('c', 200, 40, 2),
		peca('d', 35, 90, 6),
	];
	const chapa = { w: 600, h: 400 };
	const res = nestParts(partes, chapa, { kerf: 0.15 });
	const byId = new Map(partes.map((p) => [p.id, p]));

	it('devolve gap e margem efetivos', () => {
		expect(res.gap).toBe(GAP_MINIMO); // 2×0,15 = 0,3 → piso vale
		expect(res.margin).toBe(MARGEM_PADRAO);
	});

	it('coloca todas as instâncias, sem repetir instance', () => {
		const total = partes.reduce((s, p) => s + p.qty, 0);
		const colocadas = res.sheets.flatMap((s) => s.placements);
		expect(res.unplaced).toEqual([]);
		expect(colocadas.length).toBe(total);
		const chaves = new Set(colocadas.map((p) => `${p.partId}#${p.instance}`));
		expect(chaves.size).toBe(total);
	});

	it('mantém todas as peças dentro da área útil (respeitando a margem)', () => {
		for (const sheet of res.sheets) {
			for (const pl of sheet.placements) {
				const part = byId.get(pl.partId);
				if (!part) throw new Error('peça desconhecida no resultado');
				const f = footprint(part, pl.rot);
				expect(pl.x).toBeGreaterThanOrEqual(res.margin - 1e-9);
				expect(pl.y).toBeGreaterThanOrEqual(res.margin - 1e-9);
				expect(pl.x + f.w).toBeLessThanOrEqual(chapa.w - res.margin + 1e-9);
				expect(pl.y + f.h).toBeLessThanOrEqual(chapa.h - res.margin + 1e-9);
			}
		}
	});

	it('nenhum par de peças se sobrepõe — e o vão entre elas é no mínimo o gap', () => {
		for (const sheet of res.sheets) {
			for (let i = 0; i < sheet.placements.length; i++) {
				for (let j = i + 1; j < sheet.placements.length; j++) {
					const a = sheet.placements[i];
					const b = sheet.placements[j];
					const pa = byId.get(a.partId);
					const pb = byId.get(b.partId);
					if (!pa || !pb) throw new Error('peça desconhecida no resultado');
					const fa = footprint(pa, a.rot);
					const fb = footprint(pb, b.rot);
					// Separadas por >= gap em pelo menos um eixo.
					const separadas =
						a.x + fa.w + res.gap <= b.x + 1e-9 ||
						b.x + fb.w + res.gap <= a.x + 1e-9 ||
						a.y + fa.h + res.gap <= b.y + 1e-9 ||
						b.y + fb.h + res.gap <= a.y + 1e-9;
					expect(separadas).toBe(true);
				}
			}
		}
	});

	it('utilização de cada chapa fica entre 0 e 1', () => {
		expect(res.utilization.length).toBe(res.sheets.length);
		for (const u of res.utilization) {
			expect(u).toBeGreaterThan(0);
			expect(u).toBeLessThanOrEqual(1);
		}
	});
});

describe('nestParts — casos de borda', () => {
	it('peça maior que a chapa (mesmo rotacionada) vai para unplaced', () => {
		const res = nestParts([peca('gigante', 900, 50), peca('ok', 100, 100)], {
			w: 600,
			h: 400,
		});
		expect(res.unplaced).toEqual(['gigante']);
		expect(
			res.sheets.flatMap((s) => s.placements).map((p) => p.partId),
		).toEqual(['ok']);
	});

	it('peça que só cabe girada 90° é colocada girada', () => {
		// Útil = 390 × 190: em pé (90 × 380) estoura a altura; deitada (380 × 90) cabe.
		const res = nestParts([peca('alta', 90, 380)], { w: 400, h: 200 });
		expect(res.unplaced).toEqual([]);
		expect(res.sheets[0].placements[0].rot).toBe(90);
	});

	it('conta uma entrada em unplaced por instância perdida', () => {
		const res = nestParts([peca('gigante', 900, 900, 3)], { w: 600, h: 400 });
		expect(res.unplaced).toEqual(['gigante', 'gigante', 'gigante']);
		expect(res.sheets).toEqual([]);
		expect(res.utilization).toEqual([]);
	});

	it('N peças idênticas que cabem exatas não abrem uma segunda chapa', () => {
		// Útil = 2×50 + 1 gap = 101,5 em cada eixo; margem 5 dos dois lados.
		const lado = 2 * 50 + GAP_MINIMO + 2 * MARGEM_PADRAO;
		const res = nestParts([peca('q', 50, 50, 4)], { w: lado, h: lado });
		expect(res.unplaced).toEqual([]);
		expect(res.sheets.length).toBe(1);
		expect(res.sheets[0].placements.length).toBe(4);
		expect(res.utilization[0]).toBeCloseTo((4 * 2500) / (lado * lado), 9);
	});

	it('uma peça a mais do que cabe abre a segunda chapa', () => {
		const lado = 2 * 50 + GAP_MINIMO + 2 * MARGEM_PADRAO;
		const res = nestParts([peca('q', 50, 50, 5)], { w: lado, h: lado });
		expect(res.unplaced).toEqual([]);
		expect(res.sheets.length).toBe(2);
		expect(res.sheets[0].placements.length).toBe(4);
		expect(res.sheets[1].placements.length).toBe(1);
	});

	it('ignora qty <= 0 e não abre chapa à toa', () => {
		const res = nestParts([peca('zero', 50, 50, 0)], { w: 300, h: 300 });
		expect(res.sheets).toEqual([]);
		expect(res.unplaced).toEqual([]);
	});

	it('rejeita chapa sem área útil depois da margem', () => {
		expect(() => nestParts([peca('a', 5, 5)], { w: 10, h: 200 })).toThrow(
			/margem/i,
		);
	});

	it('rejeita chapa de dimensão inválida', () => {
		expect(() => nestParts([peca('a', 5, 5)], { w: 0, h: 200 })).toThrow(
			/chapa/i,
		);
	});

	it('gap e margem podem ser forçados por opts', () => {
		const res = nestParts(
			[peca('a', 10, 10, 2)],
			{ w: 100, h: 100 },
			{
				gap: 10,
				margin: 0,
			},
		);
		expect(res.gap).toBe(10);
		expect(res.margin).toBe(0);
		const [a, b] = res.sheets[0].placements;
		const dx = Math.abs(a.x - b.x);
		const dy = Math.abs(a.y - b.y);
		expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(20 - 1e-9);
	});

	it('utilização usa a área do contorno, não a da bbox', () => {
		const disco = peca('disco', 100, 100, 1, [
			circle({ x: 50, y: 50 }, 50, 'CORTE'),
		]);
		const res = nestParts([disco], { w: 200, h: 200 });
		expect(res.utilization[0]).toBeCloseTo((Math.PI * 2500) / 40000, 9);
	});

	it('lista vazia devolve resultado vazio', () => {
		const res = nestParts([], { w: 600, h: 400 });
		expect(res.sheets).toEqual([]);
		expect(res.utilization).toEqual([]);
		expect(res.unplaced).toEqual([]);
	});
});
