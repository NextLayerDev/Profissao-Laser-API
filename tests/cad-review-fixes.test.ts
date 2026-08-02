import { describe, expect, it } from 'vitest';
import { readDxf } from '@/lib/cad/dxf-read.js';
import { buildBox } from '@/lib/cad/generators/box.js';
import { nestParts } from '@/lib/cad/nest.js';
import { sketchToSvg } from '@/lib/cad/render-svg.js';

/**
 * Regressões da revisão adversarial das fases F0–F5. Cada teste aqui falhava
 * antes da correção correspondente.
 */

/** DXF mínimo com um retângulo e um círculo escrito como ARC de volta completa. */
function dxfComArc(a0: number, a1: number): string {
	return [
		'0',
		'SECTION',
		'2',
		'HEADER',
		'9',
		'$INSUNITS',
		'70',
		'4',
		'0',
		'ENDSEC',
		'0',
		'SECTION',
		'2',
		'ENTITIES',
		'0',
		'LWPOLYLINE',
		'8',
		'0',
		'90',
		'4',
		'70',
		'1',
		'10',
		'0',
		'20',
		'0',
		'10',
		'200',
		'20',
		'0',
		'10',
		'200',
		'20',
		'200',
		'10',
		'0',
		'20',
		'200',
		'0',
		'ARC',
		'8',
		'0',
		'10',
		'100',
		'20',
		'100',
		'40',
		'50',
		'50',
		String(a0),
		'51',
		String(a1),
		'0',
		'ENDSEC',
		'0',
		'EOF',
	].join('\n');
}

describe('ARC de volta completa não pode sumir do orçamento', () => {
	const perimetroCirculo = 2 * Math.PI * 50;

	it('ARC 0→360 vale a circunferência inteira, não zero', () => {
		// Vários CAMs escrevem círculo como ARC 0→360. Antes, `arcSweep` devolvia
		// 0 (por contrato) e o contorno saía com comprimento ZERO: sumia do corte
		// e da prévia, mas continuava contando uma perfuração. Num Ø100 isso
		// tirava 314 mm do job — dinheiro, em silêncio.
		const s = readDxf(dxfComArc(0, 360));
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(800 + perimetroCirculo, 3);
	});

	it('ARC 0→360 vira `circle` na IR (e não arco degenerado)', () => {
		const s = readDxf(dxfComArc(0, 360));
		const kinds = s.parts.flatMap((p) => p.paths.map((c) => c.seg.k));
		expect(kinds).toContain('circle');
		expect(kinds).not.toContain('arc');
	});

	it('ARC 0→360 aparece na prévia SVG', () => {
		// O contorno de comprimento zero também sumia do desenho — o profissional
		// não tinha como notar o furo faltando.
		const svg = sketchToSvg(readDxf(dxfComArc(0, 360)));
		const geometrias = (svg.match(/<(path|circle|polyline|polygon)\b/g) ?? [])
			.length;
		expect(geometrias).toBeGreaterThanOrEqual(2);
	});

	it('bate com o mesmo desenho escrito como ARC 0→359,9', () => {
		const cheio = readDxf(dxfComArc(0, 360)).meta.stats.cutLengthMm;
		const quase = readDxf(dxfComArc(0, 359.9)).meta.stats.cutLengthMm;
		expect(Math.abs(cheio - quase)).toBeLessThan(0.2);
	});

	it('arco parcial de verdade continua arco', () => {
		const s = readDxf(dxfComArc(0, 90));
		const kinds = s.parts.flatMap((p) => p.paths.map((c) => c.seg.k));
		expect(kinds).toContain('arc');
		expect(s.meta.stats.cutLengthMm).toBeCloseTo(800 + perimetroCirculo / 4, 3);
	});
});

describe('gravação da tampa não pode sair fora da peça', () => {
	const base = {
		largura: 60,
		profundidade: 40,
		altura: 30,
		espessura: 3,
		tampa: 'solta' as const,
	};

	it('texto longo fica DENTRO da tampa', () => {
		// O piso `Math.max(1, …)` anulava o teto de largura: o texto saía mais
		// largo que a tampa, o laser gravava fora da peça e a bbox inflada fazia o
		// nesting reservar chapa a mais.
		const s = buildBox({ ...base, gravacao_tampa: 'A'.repeat(200) });
		const tampa = s.parts.find((p) => p.id.includes('tampa'));
		expect(tampa).toBeDefined();
		const corte = tampa?.paths.filter((c) => c.layer === 'CORTE') ?? [];
		const grav = tampa?.paths.filter((c) => c.layer === 'GRAVACAO') ?? [];
		expect(grav.length).toBeGreaterThan(0);

		const xs = corte.flatMap((c) =>
			c.seg.k === 'poly' ? c.seg.pts.map((p) => p.x) : [],
		);
		const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
		for (const g of grav) {
			if (g.seg.k !== 'text') continue;
			const meia = (g.seg.text.length * 0.62 * g.seg.h) / 2;
			expect(g.seg.at.x - meia).toBeGreaterThanOrEqual(minX - 0.01);
			expect(g.seg.at.x + meia).toBeLessThanOrEqual(maxX + 0.01);
		}
	});

	it('avisa quando a gravação fica ilegível, em vez de entregar borrão calado', () => {
		const s = buildBox({ ...base, gravacao_tampa: 'A'.repeat(200) });
		expect(s.meta.warnings.join(' ')).toMatch(/borr|leg[ií]vel|curto/i);
	});

	it('texto curto não gera aviso nem encolhe', () => {
		const s = buildBox({ ...base, gravacao_tampa: 'PL' });
		expect(s.meta.warnings.join(' ')).not.toMatch(/borr/i);
	});
});

describe('folha inexistente é erro, não layout de conferência', () => {
	const sketch = buildBox({
		largura: 200,
		profundidade: 150,
		altura: 80,
		espessura: 3,
	});

	it('rejeita índice de chapa além do que o nesting produziu', () => {
		// Antes caía no grid de conferência e devolvia um arquivo plausível e
		// completamente diferente do pedido, sem nenhum erro.
		const nest = nestParts(sketch.parts, { w: 600, h: 400 });
		expect(() =>
			sketchToSvg(sketch, nest, { sheet: nest.sheets.length }),
		).toThrow(/não existe|chapa/i);
	});

	it('a última chapa válida continua funcionando', () => {
		const nest = nestParts(sketch.parts, { w: 600, h: 400 });
		expect(() =>
			sketchToSvg(sketch, nest, { sheet: nest.sheets.length - 1 }),
		).not.toThrow();
	});

	it('sem `nest` o layout de conferência continua valendo', () => {
		expect(() => sketchToSvg(sketch, undefined, { sheet: 5 })).not.toThrow();
	});
});
