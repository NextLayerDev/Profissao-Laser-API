import { describe, expect, it } from 'vitest';
import {
	type CadPath,
	circle,
	type NestResult,
	type Part,
	polyline,
	rect,
	type Sketch2D,
	text,
} from '@/lib/cad/ir.js';
import { sketchToDxf } from '@/lib/cad/render-dxf.js';
import { ToolEngineError } from '@/lib/tool-errors.js';

// ---------------------------------------------------------------------------
// Leitor mínimo de DXF (pares código/valor) — evita asserção por substring, que
// passaria com o arquivo estruturalmente quebrado.
// ---------------------------------------------------------------------------

type Par = [number, string];

function pares(dxf: string): Par[] {
	const linhas = dxf.split(/\r?\n/).map((l) => l.trim());
	const out: Par[] = [];
	for (let i = 0; i + 1 < linhas.length; i += 2) {
		out.push([Number(linhas[i]), linhas[i + 1]]);
	}
	return out;
}

interface Entidade {
	tipo: string;
	props: Map<number, string[]>;
}

function entidades(dxf: string): Entidade[] {
	const p = pares(dxf);
	const out: Entidade[] = [];
	let dentro = false;
	let atual: Entidade | null = null;
	for (let i = 0; i < p.length; i++) {
		const [code, value] = p[i];
		if (code === 2 && value === 'ENTITIES' && p[i - 1]?.[1] === 'SECTION') {
			dentro = true;
			continue;
		}
		if (!dentro) continue;
		if (code === 0) {
			if (value === 'ENDSEC') break;
			atual = { tipo: value, props: new Map() };
			out.push(atual);
			continue;
		}
		if (!atual) continue;
		const arr = atual.props.get(code) ?? [];
		arr.push(value);
		atual.props.set(code, arr);
	}
	return out;
}

/** Nome da layer → cor ACI, lido da tabela LAYER. */
function camadas(dxf: string): Map<string, number> {
	const p = pares(dxf);
	const out = new Map<string, number>();
	let dentro = false;
	let nome: string | null = null;
	for (let i = 0; i < p.length; i++) {
		const [code, value] = p[i];
		if (
			code === 2 &&
			value === 'LAYER' &&
			p[i - 1]?.[0] === 0 &&
			p[i - 1]?.[1] === 'TABLE'
		) {
			dentro = true;
			continue;
		}
		if (!dentro) continue;
		if (code === 0 && value === 'ENDTAB') break;
		if (code === 0) {
			nome = null;
			continue;
		}
		if (code === 2) nome = value;
		if (code === 62 && nome) out.set(nome, Number(value));
	}
	return out;
}

/** Valor de uma variável de header: mapa código → valor. */
function headerVar(dxf: string, nome: string): Map<number, string> {
	const p = pares(dxf);
	const i = p.findIndex((x) => x[0] === 9 && x[1] === nome);
	const out = new Map<number, string>();
	if (i < 0) return out;
	for (let j = i + 1; j < p.length && p[j][0] !== 9; j++) {
		out.set(p[j][0], p[j][1]);
	}
	return out;
}

function tipos(dxf: string): string[] {
	return entidades(dxf).map((e) => e.tipo);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function peca(
	id: string,
	paths: CadPath[],
	w: number,
	h: number,
	qty = 1,
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

function desenho(parts: Part[]): Sketch2D {
	return {
		units: 'mm',
		schema: 1,
		parts,
		meta: {
			generator: 'teste',
			params: {},
			kerf: 0.2,
			clearance: 0.1,
			warnings: [],
			stats: {
				partCount: 0,
				cutLengthMm: 0,
				engraveLengthMm: 0,
				pierces: 0,
				areaMm2: 0,
			},
		},
	};
}

/** Placa 100×60 com um furo de raio 5 no centro — o caso canônico. */
function placaComFuro(): Sketch2D {
	return desenho([
		peca(
			'placa',
			[rect(0, 0, 100, 60, 'CORTE'), circle({ x: 50, y: 30 }, 5, 'CORTE')],
			100,
			60,
		),
	]);
}

// ---------------------------------------------------------------------------

describe('sketchToDxf — cabeçalho e layers', () => {
	it('declara as unidades em milímetros ($INSUNITS = 4)', () => {
		const dxf = sketchToDxf(placaComFuro());
		expect(headerVar(dxf, '$INSUNITS').get(70)).toBe('4');
	});

	it('cria só as layers usadas, com a cor ACI e linetype Continuous', () => {
		const sketch = desenho([
			peca(
				'p',
				[
					rect(0, 0, 20, 20, 'CORTE'),
					text({ x: 2, y: 2 }, 'ABC', 4, 'GRAVACAO'),
				],
				20,
				20,
			),
		]);
		const dxf = sketchToDxf(sketch);
		const layers = camadas(dxf);
		expect(layers.get('CORTE')).toBe(1);
		expect(layers.get('GRAVACAO')).toBe(5);
		// MARCACAO/DOBRA/REFERENCIA não foram usadas: nada de layer vazia.
		expect(layers.has('MARCACAO')).toBe(false);
		expect(layers.has('DOBRA')).toBe(false);
		expect(layers.has('REFERENCIA')).toBe(false);
		expect(dxf).toContain('Continuous');
	});

	it('não emite número em notação exponencial', () => {
		// "1e-16" é lido como 0 (ou aborta o arquivo) em leitor de DXF antigo.
		const dxf = sketchToDxf(
			desenho([
				peca('p', [circle({ x: 1 / 3, y: 1e-15 }, 1 / 7, 'CORTE')], 1, 1),
			]),
		);
		expect(dxf).not.toMatch(/\d[eE][+-]?\d/);
	});

	it('recusa desenho sem geometria', () => {
		expect(() => sketchToDxf(desenho([]))).toThrow(ToolEngineError);
		expect(() => sketchToDxf(desenho([]))).toThrow(/geometria/i);
	});
});

describe('sketchToDxf — retângulo com furo', () => {
	it('gera exatamente uma LWPOLYLINE fechada e um CIRCLE, ambos em CORTE', () => {
		const dxf = sketchToDxf(placaComFuro());
		const ents = entidades(dxf);

		expect(tipos(dxf)).toEqual(['LWPOLYLINE', 'CIRCLE']);

		const poly = ents[0];
		expect(poly.props.get(8)).toEqual(['CORTE']);
		expect(poly.props.get(70)).toEqual(['1']); // flag fechada
		expect(poly.props.get(90)).toEqual(['4']); // 4 vértices
		expect(poly.props.get(10)).toEqual(['0', '100', '100', '0']);
		expect(poly.props.get(20)).toEqual(['0', '0', '60', '60']);

		const circ = ents[1];
		expect(circ.props.get(8)).toEqual(['CORTE']);
		expect(circ.props.get(10)).toEqual(['50']);
		expect(circ.props.get(20)).toEqual(['30']);
		expect(circ.props.get(40)).toEqual(['5']);
	});

	it('escreve $EXTMIN/$EXTMAX iguais à bbox do conteúdo', () => {
		const dxf = sketchToDxf(placaComFuro());
		const min = headerVar(dxf, '$EXTMIN');
		const max = headerVar(dxf, '$EXTMAX');
		expect([min.get(10), min.get(20), min.get(30)]).toEqual(['0', '0', '0']);
		expect([max.get(10), max.get(20), max.get(30)]).toEqual(['100', '60', '0']);
	});
});

describe('sketchToDxf — conversão de segmentos', () => {
	it('emite LINE, ARC, CIRCLE, LWPOLYLINE e TEXT conforme a entrada', () => {
		const sketch = desenho([
			peca(
				'p',
				[
					{
						layer: 'CORTE',
						seg: { k: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
					},
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
					circle({ x: 5, y: 5 }, 2, 'CORTE'),
					polyline(
						[
							{ x: 0, y: 0 },
							{ x: 4, y: 0 },
						],
						false,
						'MARCACAO',
					),
					text({ x: 1, y: 1 }, 'OK', 3, 'GRAVACAO'),
				],
				10,
				10,
			),
		]);
		const dxf = sketchToDxf(sketch);
		// Agrupado por layer na ordem canônica: CORTE, GRAVACAO, MARCACAO.
		expect(tipos(dxf)).toEqual(['LINE', 'ARC', 'CIRCLE', 'TEXT', 'LWPOLYLINE']);

		const linha = entidades(dxf)[0];
		expect(linha.props.get(10)).toEqual(['0']);
		expect(linha.props.get(11)).toEqual(['10']);

		const arco = entidades(dxf)[1];
		expect(arco.props.get(40)).toEqual(['10']);
		expect(arco.props.get(50)).toEqual(['0']);
		expect(arco.props.get(51)).toEqual(['90']);

		const poly = entidades(dxf)[4];
		expect(poly.props.get(70)).toEqual(['0']); // aberta
	});

	it('inverte as pontas do arco horário (o ARC do DXF só anda anti-horário)', () => {
		const sketch = desenho([
			peca(
				'p',
				[
					{
						layer: 'CORTE',
						seg: {
							k: 'arc',
							c: { x: 0, y: 0 },
							r: 10,
							a0: 0,
							a1: Math.PI / 2,
							ccw: false,
						},
					},
				],
				10,
				10,
			),
		]);
		const arco = entidades(sketchToDxf(sketch))[0];
		// Arco horário de 0° a 90° = arco anti-horário de 90° a 0° (270° de varredura).
		expect(arco.props.get(50)).toEqual(['90']);
		expect(arco.props.get(51)).toEqual(['0']);
	});

	it('leva o bulge de cada vértice para o grupo 42 do LWPOLYLINE', () => {
		const sketch = desenho([
			peca(
				'p',
				[
					polyline(
						[
							{ x: 0, y: 0 },
							{ x: 10, y: 0 },
						],
						true,
						'CORTE',
						[1, 1],
					),
				],
				10,
				5,
			),
		]);
		const poly = entidades(sketchToDxf(sketch))[0];
		expect(poly.props.get(42)).toEqual(['1', '1']);
	});

	it('preenche o segundo ponto de alinhamento quando o texto é centralizado', () => {
		const sketch = desenho([
			peca(
				'p',
				[text({ x: 5, y: 5 }, 'PL', 4, 'GRAVACAO', { anchor: 'c', rot: 45 })],
				10,
				10,
			),
		]);
		const t = entidades(sketchToDxf(sketch))[0];
		expect(t.tipo).toBe('TEXT');
		expect(t.props.get(1)).toEqual(['PL']);
		expect(t.props.get(40)).toEqual(['4']);
		expect(t.props.get(50)).toEqual(['45']);
		expect(t.props.get(72)).toEqual(['1']); // centralizado
		// O grupo 11 tem que existir e coincidir com o ponto de inserção (grupo 10);
		// sem ele o leitor ignora o alinhamento e joga o texto para a origem.
		// Comparar com o 10 em vez de com um literal: esta peça é só um texto
		// rotacionado, então o exportador a normaliza para a origem (minX = minY = 0)
		// e o ponto de inserção deixa de ser o (5, 5) escrito no fixture.
		expect(t.props.get(11)).toEqual(t.props.get(10));
		expect(t.props.get(11)).toHaveLength(1);
	});
});

describe('sketchToDxf — arranjo', () => {
	it('sem nesting, enfileira as instâncias com o gap pedido', () => {
		const sketch = desenho([
			peca('p', [rect(0, 0, 20, 10, 'CORTE')], 20, 10, 2),
		]);
		const dxf = sketchToDxf(sketch, undefined, { gap: 5 });
		const ents = entidades(dxf);
		expect(ents).toHaveLength(2);
		expect(ents[0].props.get(10)).toEqual(['0', '20', '20', '0']);
		// Segunda instância deslocada de 20 + 5.
		expect(ents[1].props.get(10)).toEqual(['25', '45', '45', '25']);
		expect(headerVar(dxf, '$EXTMAX').get(10)).toBe('45');
	});

	it('com nesting, aplica rotação de 90° e translação de cada placement', () => {
		const sketch = desenho([
			peca('p', [rect(0, 0, 10, 20, 'CORTE')], 10, 20, 2),
		]);
		const nest: NestResult = {
			sheets: [
				{
					w: 300,
					h: 200,
					placements: [
						{ partId: 'p', instance: 0, x: 5, y: 5, rot: 0 },
						{ partId: 'p', instance: 1, x: 50, y: 5, rot: 90 },
					],
				},
			],
			utilization: [0.01],
			unplaced: [],
			gap: 2,
			margin: 5,
		};
		const dxf = sketchToDxf(sketch, nest);
		const ents = entidades(dxf);
		expect(ents).toHaveLength(2);

		expect(ents[0].props.get(10)).toEqual(['5', '15', '15', '5']);
		expect(ents[0].props.get(20)).toEqual(['5', '5', '25', '25']);

		// Girada, a peça 10×20 ocupa 20×10 a partir de (50, 5).
		const xs = (ents[1].props.get(10) ?? []).map(Number);
		const ys = (ents[1].props.get(20) ?? []).map(Number);
		expect(Math.min(...xs)).toBe(50);
		expect(Math.max(...xs)).toBe(70);
		expect(Math.min(...ys)).toBe(5);
		expect(Math.max(...ys)).toBe(15);

		const max = headerVar(dxf, '$EXTMAX');
		expect([max.get(10), max.get(20)]).toEqual(['70', '25']);
	});

	it('não desenha a chapa por padrão e a desenha em REFERENCIA sob pedido', () => {
		const sketch = desenho([peca('p', [rect(0, 0, 10, 10, 'CORTE')], 10, 10)]);
		const nest: NestResult = {
			sheets: [
				{
					w: 300,
					h: 200,
					placements: [{ partId: 'p', instance: 0, x: 5, y: 5, rot: 0 }],
				},
			],
			utilization: [0.01],
			unplaced: [],
			gap: 2,
			margin: 5,
		};

		const semChapa = sketchToDxf(sketch, nest);
		expect(entidades(semChapa)).toHaveLength(1);
		expect(camadas(semChapa).has('REFERENCIA')).toBe(false);
		expect(headerVar(semChapa, '$EXTMAX').get(10)).toBe('15');

		const comChapa = sketchToDxf(sketch, nest, { incluirChapa: true });
		const ents = entidades(comChapa);
		expect(ents).toHaveLength(2);
		expect(camadas(comChapa).get('REFERENCIA')).toBe(8);
		// A chapa é a última porque REFERENCIA é a última layer da ordem canônica.
		expect(ents[1].props.get(8)).toEqual(['REFERENCIA']);
		expect(headerVar(comChapa, '$EXTMAX').get(10)).toBe('300');
		expect(headerVar(comChapa, '$EXTMAX').get(20)).toBe('200');
	});

	it('rejeita placement que aponta para peça inexistente', () => {
		const sketch = desenho([peca('p', [rect(0, 0, 10, 10, 'CORTE')], 10, 10)]);
		const nest: NestResult = {
			sheets: [
				{
					w: 100,
					h: 100,
					placements: [{ partId: 'fantasma', instance: 0, x: 0, y: 0, rot: 0 }],
				},
			],
			utilization: [0],
			unplaced: [],
			gap: 2,
			margin: 5,
		};
		expect(() => sketchToDxf(sketch, nest)).toThrow(ToolEngineError);
		expect(() => sketchToDxf(sketch, nest)).toThrow(/fantasma/);
	});
});
