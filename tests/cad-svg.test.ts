import { describe, expect, it } from 'vitest';
import {
	bboxOf,
	type CadPath,
	circle,
	computeStats,
	type NestResult,
	type Part,
	rect,
	roundRect,
	type Sketch2D,
	slot,
	text,
} from '@/lib/cad/ir.js';
import { sketchToDataUrl, sketchToSvg } from '@/lib/cad/render-svg.js';

function part(id: string, paths: CadPath[], qty = 1): Part {
	const bb = bboxOf(paths);
	return {
		id,
		label: id,
		thickness: 3,
		material: 'MDF',
		paths,
		bbox: { w: bb.w, h: bb.h },
		qty,
	};
}

function sketch(parts: Part[]): Sketch2D {
	return {
		units: 'mm',
		schema: 1,
		parts,
		meta: {
			generator: 'teste',
			params: {},
			kerf: 0.15,
			clearance: 0.1,
			warnings: [],
			stats: computeStats(parts),
		},
	};
}

const simples = sketch([part('base', [rect(0, 0, 100, 50, 'CORTE')])]);

describe('sketchToSvg — dimensões', () => {
	it('sai em mm de verdade, com viewBox na mesma escala', () => {
		const svg = sketchToSvg(simples, undefined, { margin: 5 });
		// 100 × 50 mm + 5 mm de margem de cada lado.
		expect(svg).toContain('width="110mm"');
		expect(svg).toContain('height="60mm"');
		expect(svg).toContain('viewBox="0 0 110 60"');
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
	});

	it('desenha a chapa do nesting com as dimensões da chapa', () => {
		const nest: NestResult = {
			sheets: [
				{
					w: 600,
					h: 400,
					placements: [{ partId: 'base', instance: 0, x: 10, y: 20, rot: 0 }],
				},
			],
			utilization: [0.02],
			unplaced: [],
			gap: 2,
			margin: 5,
		};
		const svg = sketchToSvg(simples, nest, { margin: 0 });
		expect(svg).toContain('width="600mm"');
		expect(svg).toContain('height="400mm"');
		expect(svg).toContain('data-part="__chapa"');
		// Peça posicionada em (10, 20) pelo nesting.
		expect(svg).toContain('M 10 20');
	});

	it('produz SVG válido mesmo sem peça nenhuma', () => {
		const svg = sketchToSvg(sketch([]), undefined, { margin: 0 });
		expect(svg).toContain('width="1mm"');
		expect(svg).toContain('height="1mm"');
		expect(svg).not.toContain('NaN');
	});
});

describe('sketchToSvg — flip de Y', () => {
	it('embrulha tudo no grupo espelhado (CAD Y+ para cima → SVG Y+ para baixo)', () => {
		const svg = sketchToSvg(simples, undefined, { margin: 5 });
		expect(svg).toContain('transform="translate(0 60) scale(1 -1)"');
	});

	it('texto leva contra-flip local para não sair de cabeça para baixo', () => {
		const svg = sketchToSvg(
			sketch([
				part('etiqueta', [
					rect(0, 0, 40, 20, 'CORTE'),
					text({ x: 20, y: 10 }, 'LADO A', 4, 'GRAVACAO', { anchor: 'c' }),
				]),
			]),
		);
		expect(svg).toContain('<text transform="translate(24 14) scale(1 -1)"');
		expect(svg).toContain('text-anchor="middle"');
		expect(svg).toContain('>LADO A</text>');
	});

	it('rotação de texto entra com sinal trocado (o frame interno volta a ser Y para baixo)', () => {
		const svg = sketchToSvg(
			sketch([
				part('r', [text({ x: 0, y: 0 }, 'X', 5, 'MARCACAO', { rot: 90 })]),
			]),
			undefined,
			{ margin: 0 },
		);
		expect(svg).toContain('scale(1 -1) rotate(-90)');
	});

	it('escapa caracteres de XML no texto', () => {
		const svg = sketchToSvg(
			sketch([part('x', [text({ x: 0, y: 0 }, 'A & <B>', 3, 'GRAVACAO')])]),
		);
		expect(svg).toContain('A &amp; &lt;B&gt;');
	});
});

describe('sketchToSvg — camadas', () => {
	it('cada instância vira um <g data-layer> por camada, com a cor da camada', () => {
		const svg = sketchToSvg(
			sketch([
				part('tampa', [
					rect(0, 0, 60, 40, 'CORTE'),
					circle({ x: 30, y: 20 }, 5, 'GRAVACAO'),
					text({ x: 5, y: 5 }, 'T', 3, 'MARCACAO'),
				]),
			]),
		);
		expect(svg).toContain('data-layer="CORTE"');
		expect(svg).toContain('data-layer="GRAVACAO"');
		expect(svg).toContain('data-layer="MARCACAO"');
		expect(svg).toContain('data-part="tampa"');
		expect(svg).toContain('stroke="#e11d48"');
		expect(svg).toContain('stroke="#2563eb"');
		expect(svg).toContain('stroke="#16a34a"');
		// Camada ausente não gera grupo vazio.
		expect(svg).not.toContain('data-layer="REFERENCIA"');
	});

	it('DOBRA sai tracejada', () => {
		const svg = sketchToSvg(sketch([part('d', [rect(0, 0, 10, 10, 'DOBRA')])]));
		expect(svg).toContain('stroke="#a855f7"');
		expect(svg).toMatch(/data-layer="DOBRA"[^>]*stroke-dasharray=/);
	});

	it('traço é hairline em qualquer zoom', () => {
		const svg = sketchToSvg(simples);
		expect(svg).toContain('fill="none"');
		expect(svg).toContain('stroke-width="0.2"');
		expect(svg).toContain('vector-effect="non-scaling-stroke"');
	});
});

describe('sketchToSvg — geometria', () => {
	it('bulge vira comando A com raio e flags', () => {
		const svg = sketchToSvg(
			sketch([part('c', [roundRect(0, 0, 40, 30, 5, 'CORTE')])]),
			undefined,
			{ margin: 0 },
		);
		// Canto de 90° anti-horário: raio 5, large-arc 0, sweep 1.
		expect(svg).toContain('A 5 5 0 0 1');
		expect(svg).toContain('Z');
	});

	it('semicírculo do rasgo é large-arc 0 e sweep 1 (180° não passa de 180°)', () => {
		const svg = sketchToSvg(
			sketch([part('s', [slot(0, 0, 30, 10, 'CORTE')])]),
			undefined,
			{ margin: 0 },
		);
		expect(svg).toContain('A 5 5 0 0 1');
	});

	it('círculo usa <circle> nativo', () => {
		const svg = sketchToSvg(
			sketch([part('f', [circle({ x: 10, y: 10 }, 3, 'CORTE')])]),
			undefined,
			{ margin: 0 },
		);
		// A peça é normalizada para a origem: o furo de raio 3 centra em (3, 3).
		expect(svg).toContain(
			'<circle vector-effect="non-scaling-stroke" cx="3" cy="3" r="3"/>',
		);
	});

	it('peça fora da origem é normalizada para o canto do desenho', () => {
		const svg = sketchToSvg(
			sketch([part('off', [rect(-50, -20, 10, 10, 'CORTE')])]),
			undefined,
			{ margin: 0 },
		);
		expect(svg).toContain('M 0 0');
		expect(svg).toContain('width="10mm"');
	});

	it('duas peças ficam lado a lado sem sobrepor', () => {
		const svg = sketchToSvg(
			sketch([
				part('a', [rect(0, 0, 20, 10, 'CORTE')]),
				part('b', [rect(0, 0, 20, 10, 'CORTE')]),
			]),
			undefined,
			{ margin: 0, gap: 4 },
		);
		expect(svg).toContain('width="44mm"');
		expect(svg).toContain('data-part="a"');
		expect(svg).toContain('data-part="b"');
	});
});

describe('sketchToDataUrl', () => {
	it('é base64 e decodifica de volta para o mesmo SVG', () => {
		const svg = sketchToSvg(simples, undefined, { margin: 5 });
		const url = sketchToDataUrl(simples, undefined, { margin: 5 });
		expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
		const b64 = url.slice('data:image/svg+xml;base64,'.length);
		expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(svg);
	});

	it('não deixa vazar o "#" das cores na URL (o que truncaria o documento)', () => {
		const url = sketchToDataUrl(simples);
		expect(url).not.toContain('#');
	});
});
