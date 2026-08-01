import { describe, expect, it } from 'vitest';
import { readDxf } from '@/lib/cad/dxf-read.js';
import { buildBox } from '@/lib/cad/generators/box.js';
import {
	BULGE_90,
	type CadPath,
	circle,
	type LayerId,
	type Pt,
	polyline,
	rect,
	type Seg,
	type Sketch2D,
	TAU,
	text,
} from '@/lib/cad/ir.js';
import {
	analyzeAndDiagnose,
	analyzeGeometry,
	chainContours,
	type Diagnostic,
	diagnose,
} from '@/lib/cad/topology.js';
import { ToolEngineError } from '@/lib/tool-errors.js';

// ---------------------------------------------------------------------------
// Helpers de fixture
// ---------------------------------------------------------------------------

/** Monta um `Sketch2D` de uma peça só a partir de caminhos crus. */
function sketchDe(paths: CadPath[], qty = 1): Sketch2D {
	const xs: number[] = [];
	const ys: number[] = [];
	for (const p of paths) {
		for (const pt of pontosDe(p.seg)) {
			xs.push(pt.x);
			ys.push(pt.y);
		}
	}
	const w = xs.length > 0 ? Math.max(...xs) - Math.min(...xs) : 0;
	const h = ys.length > 0 ? Math.max(...ys) - Math.min(...ys) : 0;
	return {
		units: 'mm',
		schema: 1,
		parts: [
			{
				id: 'p',
				label: 'teste',
				thickness: 0,
				material: '',
				paths,
				bbox: { w, h },
				qty,
			},
		],
		meta: {
			generator: 'teste',
			params: {},
			kerf: 0,
			clearance: 0,
			warnings: [],
			stats: {
				partCount: qty,
				cutLengthMm: 0,
				engraveLengthMm: 0,
				pierces: 0,
				areaMm2: 0,
			},
		},
	};
}

function pontosDe(seg: Seg): Pt[] {
	switch (seg.k) {
		case 'line':
			return [seg.a, seg.b];
		case 'circle':
			return [
				{ x: seg.c.x - seg.r, y: seg.c.y - seg.r },
				{ x: seg.c.x + seg.r, y: seg.c.y + seg.r },
			];
		case 'arc':
			return [seg.c];
		case 'poly':
			return seg.pts;
		case 'text':
			return [seg.at];
	}
}

function linha(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	layer: LayerId = 'CORTE',
): CadPath {
	return {
		layer,
		seg: { k: 'line', a: { x: x1, y: y1 }, b: { x: x2, y: y2 } },
	};
}

/** As 4 linhas SOLTAS de um retângulo — o caso que todo DXF de campo entrega. */
function retanguloEmLinhas(
	x: number,
	y: number,
	w: number,
	h: number,
	layer: LayerId = 'CORTE',
): CadPath[] {
	return [
		linha(x, y, x + w, y, layer),
		linha(x + w, y, x + w, y + h, layer),
		linha(x + w, y + h, x, y + h, layer),
		linha(x, y + h, x, y, layer),
	];
}

function porCodigo(diags: Diagnostic[], code: string): Diagnostic | undefined {
	return diags.find((d) => d.code === code);
}

// ---------------------------------------------------------------------------
// Encadeamento
// ---------------------------------------------------------------------------

describe('chainContours', () => {
	it('4 linhas soltas formando um retângulo dão 1 contorno FECHADO', () => {
		// É O teste do módulo: sem isto, retângulo com furo viraria "5 contornos
		// abertos" e o preço iria para o lixo.
		const r = chainContours(retanguloEmLinhas(0, 0, 100, 60));
		expect(r.cadeias).toHaveLength(1);
		expect(r.cadeias[0].closed).toBe(true);
		expect(r.cadeias[0].segs).toHaveLength(4);
		expect(r.cadeias[0].lengthMm).toBeCloseTo(320, 9);
		expect(r.cadeias[0].gapMm).toBe(0);
		expect(r.bifurcacoes).toBe(0);
	});

	it('encadeia com as linhas fora de ordem e em sentidos trocados', () => {
		// DXF não garante ordem nem sentido: a 2ª linha pode vir desenhada de trás
		// para frente. O grafo tem de aguentar.
		const paths = [
			linha(0, 0, 100, 0),
			linha(0, 60, 0, 0),
			linha(100, 60, 100, 0), // invertida
			linha(100, 60, 0, 60),
		];
		const r = chainContours(paths);
		expect(r.cadeias).toHaveLength(1);
		expect(r.cadeias[0].closed).toBe(true);
		expect(r.cadeias[0].lengthMm).toBeCloseTo(320, 9);
	});

	it('junta pontas separadas por menos que a tolerância (0,02 mm)', () => {
		const paths = [
			linha(0, 0, 100, 0),
			linha(100.008, 0, 100, 60),
			linha(100, 60, 0, 60),
			linha(0, 60, 0, 0),
		];
		const r = chainContours(paths);
		expect(r.cadeias).toHaveLength(1);
		expect(r.cadeias[0].closed).toBe(true);
	});

	it('não junta pontas acima da tolerância', () => {
		const paths = [
			linha(0, 0, 100, 0),
			linha(100.5, 0, 100.5, 60), // 0,5 mm de fenda
			linha(100.5, 60, 0, 60),
			linha(0, 60, 0, 0),
		];
		const r = chainContours(paths);
		expect(r.cadeias).toHaveLength(1);
		expect(r.cadeias[0].closed).toBe(false);
		expect(r.cadeias[0].gapMm).toBeCloseTo(0.5, 6);
	});

	it('não encadeia através de camadas diferentes', () => {
		// Linha de gravação que encosta no contorno não pode virar parte dele.
		const paths = [
			linha(0, 0, 100, 0),
			linha(100, 0, 100, 60, 'GRAVACAO'),
			linha(100, 60, 0, 60),
			linha(0, 60, 0, 0),
		];
		const r = chainContours(paths);
		expect(r.cadeias).toHaveLength(2);
		const corte = r.cadeias.find((c) => c.layer === 'CORTE');
		const grav = r.cadeias.find((c) => c.layer === 'GRAVACAO');
		expect(corte?.closed).toBe(false);
		expect(grav?.lengthMm).toBeCloseTo(60, 9);
	});

	it('nó de grau > 2 fecha a cadeia ali e é contado como bifurcação', () => {
		// "T": três linhas saindo do mesmo ponto. Escolher um ramo seria inventar
		// geometria que o cliente não desenhou.
		const paths = [
			linha(0, 0, 50, 0),
			linha(50, 0, 100, 0),
			linha(50, 0, 50, 40),
		];
		const r = chainContours(paths);
		expect(r.bifurcacoes).toBe(1);
		expect(r.cadeias.length).toBeGreaterThan(1);
		const total = r.cadeias.reduce((s, c) => s + c.lengthMm, 0);
		expect(total).toBeCloseTo(140, 9);
	});

	it('descarta entidade de comprimento nulo em vez de colar cadeias', () => {
		const paths = [
			linha(0, 0, 100, 0),
			linha(100, 0, 100, 0), // nula
			linha(100, 0, 100, 60),
		];
		const r = chainContours(paths);
		expect(r.degenerados).toBe(1);
		expect(r.cadeias).toHaveLength(1);
		expect(r.cadeias[0].lengthMm).toBeCloseTo(160, 9);
	});

	it('círculo e polilinha fechada entram como contorno pronto', () => {
		const r = chainContours([
			circle({ x: 0, y: 0 }, 5, 'CORTE'),
			rect(0, 0, 10, 10, 'CORTE'),
		]);
		expect(r.cadeias).toHaveLength(2);
		expect(r.cadeias.every((c) => c.closed)).toBe(true);
	});

	it('conta texto e texto na camada de corte', () => {
		const r = chainContours([
			text({ x: 0, y: 0 }, 'ABC', 5, 'CORTE'),
			text({ x: 0, y: 10 }, 'DEF', 5, 'GRAVACAO'),
		]);
		expect(r.textos).toBe(2);
		expect(r.textosNoCorte).toBe(1);
		expect(r.cadeias).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

describe('analyzeGeometry', () => {
	it('retângulo com 2 furos: área líquida exata e n_furos = 2', () => {
		const m = analyzeGeometry(
			sketchDe([
				...retanguloEmLinhas(0, 0, 100, 60),
				circle({ x: 25, y: 30 }, 5, 'CORTE'),
				circle({ x: 75, y: 30 }, 5, 'CORTE'),
			]),
		);
		expect(m.n_contornos).toBe(3);
		expect(m.n_abertos).toBe(0);
		expect(m.n_furos).toBe(2);
		expect(m.n_pecas).toBe(1);
		expect(m.n_piercings).toBe(3);
		// Área EXATA: o furo vale π·r², não a área do polígono inscrito.
		expect(m.area_liquida_mm2).toBeCloseTo(100 * 60 - 2 * Math.PI * 25, 6);
		expect(m.area_bruta_mm2).toBeCloseTo(6000, 6);
		expect(m.comprimento_corte_mm).toBeCloseTo(320 + 2 * TAU * 5, 6);
		expect(m.pecas).toHaveLength(1);
		expect(m.pecas[0].furos).toBe(2);
		expect(m.pecas[0].areaLiquidaMm2).toBeCloseTo(m.area_liquida_mm2, 9);
	});

	it('furo dentro de ilha dentro de peça dá depth 0 / 1 / 2', () => {
		const m = analyzeGeometry(
			sketchDe([
				...retanguloEmLinhas(0, 0, 100, 100),
				circle({ x: 50, y: 50 }, 30, 'CORTE'),
				circle({ x: 50, y: 50 }, 10, 'CORTE'),
			]),
		);
		const ordenados = [...m.contornos].sort(
			(a, b) => Math.abs(b.areaSigned) - Math.abs(a.areaSigned),
		);
		expect(ordenados.map((c) => c.depth)).toEqual([0, 1, 2]);
		// A ilha volta a ser material: 100² − π·30² + π·10².
		expect(m.area_liquida_mm2).toBeCloseTo(
			10000 - Math.PI * 900 + Math.PI * 100,
			6,
		);
		// Só o de depth ímpar é furo.
		expect(m.n_furos).toBe(1);
		expect(m.n_pecas).toBe(1);
		// O pai de cada um é o MENOR contorno que o contém.
		expect(ordenados[2].parent).not.toBeNull();
		expect(m.contornos[ordenados[2].parent as number].id).toBe(ordenados[1].id);
	});

	it('duas peças lado a lado não viram peça e furo', () => {
		const m = analyzeGeometry(
			sketchDe([
				...retanguloEmLinhas(0, 0, 40, 40),
				...retanguloEmLinhas(60, 0, 40, 40),
			]),
		);
		expect(m.n_pecas).toBe(2);
		expect(m.n_furos).toBe(0);
		expect(m.area_liquida_mm2).toBeCloseTo(3200, 6);
	});

	it('área exata soma a correção dos arcos (bulge), não a corda', () => {
		// Retângulo 80×40 com cantos R=10 por bulge: WH − (4 − π)·R².
		const rr = polyline(
			[
				{ x: 10, y: 0 },
				{ x: 70, y: 0 },
				{ x: 80, y: 10 },
				{ x: 80, y: 30 },
				{ x: 70, y: 40 },
				{ x: 10, y: 40 },
				{ x: 0, y: 30 },
				{ x: 0, y: 10 },
			],
			true,
			'CORTE',
			[0, BULGE_90, 0, BULGE_90, 0, BULGE_90, 0, BULGE_90],
		);
		const m = analyzeGeometry(sketchDe([rr]));
		expect(m.area_liquida_mm2).toBeCloseTo(80 * 40 - (4 - Math.PI) * 100, 6);
		expect(m.comprimento_corte_mm).toBeCloseTo(120 + 40 + TAU * 10, 6);
	});

	it('linhas + arcos soltos encadeiam num rasgo, com área e comprimento exatos', () => {
		// Rasgo 80×20 (pontas em semicírculo R=10) picado em 4 entidades, fora de
		// ordem e com uma delas invertida — é o que sai de um DXF de verdade.
		const arcoDireito: CadPath = {
			layer: 'CORTE',
			seg: {
				k: 'arc',
				c: { x: 70, y: 10 },
				r: 10,
				a0: -Math.PI / 2,
				a1: Math.PI / 2,
				ccw: true,
			},
		};
		const arcoEsquerdo: CadPath = {
			layer: 'CORTE',
			seg: {
				k: 'arc',
				c: { x: 10, y: 10 },
				r: 10,
				a0: Math.PI / 2,
				a1: (3 * Math.PI) / 2,
				ccw: true,
			},
		};
		const m = analyzeGeometry(
			sketchDe([
				linha(70, 20, 10, 20), // topo, no sentido do percurso
				arcoEsquerdo,
				linha(10, 0, 70, 0),
				arcoDireito,
			]),
		);
		expect(m.n_contornos).toBe(1);
		expect(m.n_pecas).toBe(1);
		expect(m.contornos[0].closed).toBe(true);
		expect(m.comprimento_corte_mm).toBeCloseTo(120 + TAU * 10, 6);
		// Inverter um arco no encadeamento tem de inverter `ccw` E o sinal da
		// correção de área — senão a ponta arredondada viraria mordida.
		expect(m.area_liquida_mm2).toBeCloseTo(60 * 20 + Math.PI * 100, 6);
	});

	it('bbox contida não basta: círculo no vão de um "C" não é furo', () => {
		// O pré-filtro por bbox aprova (o vão está dentro da caixa do C); só o ray
		// casting sabe que ali é fora da peça. Sem ele, o vão viraria furo e a área
		// do material sairia menor do que é.
		const c = polyline(
			[
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 100, y: 20 },
				{ x: 40, y: 20 },
				{ x: 40, y: 80 },
				{ x: 100, y: 80 },
				{ x: 100, y: 100 },
				{ x: 0, y: 100 },
			],
			true,
			'CORTE',
		);
		const m = analyzeGeometry(
			sketchDe([c, circle({ x: 70, y: 50 }, 10, 'CORTE')]),
		);
		expect(m.n_furos).toBe(0);
		expect(m.n_pecas).toBe(2);
		expect(m.area_liquida_mm2).toBeCloseTo(6400 + Math.PI * 100, 6);
	});

	it('furo que encosta na borda da peça continua sendo furo', () => {
		// Vértice compartilhado: o ray casting em cima da aresta do outro contorno
		// responde a moeda ao ar — daí o ponto de prova deslocado.
		const m = analyzeGeometry(
			sketchDe([
				...retanguloEmLinhas(0, 0, 100, 60),
				rect(0, 10, 30, 40, 'CORTE'),
			]),
		);
		expect(m.n_furos).toBe(1);
		expect(m.n_pecas).toBe(1);
		expect(m.area_liquida_mm2).toBeCloseTo(6000 - 1200, 6);
	});

	it('contorno aberto órfão vira pseudo-peça e avisa', () => {
		const m = analyzeGeometry(
			sketchDe([linha(0, 0, 50, 0), linha(50, 0, 50, 30)]),
		);
		expect(m.n_abertos).toBe(1);
		expect(m.n_pecas).toBe(1);
		expect(m.pecas[0].aberta).toBe(true);
		expect(m.pecas[0].areaLiquidaMm2).toBe(0);
		expect(m.area_liquida_mm2).toBe(0);
		expect(m.avisos.join(' ')).toContain('geometria solta');
	});

	it('linha solta DENTRO de uma peça não vira pseudo-peça', () => {
		const m = analyzeGeometry(
			sketchDe([
				...retanguloEmLinhas(0, 0, 100, 60),
				linha(20, 20, 80, 20), // rabisco dentro da peça
			]),
		);
		expect(m.n_pecas).toBe(1);
		expect(m.n_abertos).toBe(1);
		const solta = m.contornos.find((c) => !c.closed);
		expect(solta?.depth).toBe(1);
		// Aberto não tem área: a peça continua inteira.
		expect(m.area_liquida_mm2).toBeCloseTo(6000, 6);
	});

	it('gravação não conta como furo nem entra no comprimento de corte', () => {
		const m = analyzeGeometry(
			sketchDe([
				...retanguloEmLinhas(0, 0, 100, 60),
				circle({ x: 50, y: 30 }, 8, 'GRAVACAO'),
			]),
		);
		expect(m.n_furos).toBe(0);
		expect(m.n_contornos).toBe(1);
		expect(m.comprimento_corte_mm).toBeCloseTo(320, 9);
		expect(m.comprimento_gravacao_mm).toBeCloseTo(TAU * 8, 9);
		expect(m.area_liquida_mm2).toBeCloseTo(6000, 6);
	});

	it('multiplica comprimentos e contagens pelo qty da peça', () => {
		const m = analyzeGeometry(
			sketchDe([...retanguloEmLinhas(0, 0, 100, 60)], 3),
		);
		expect(m.comprimento_corte_mm).toBeCloseTo(960, 9);
		expect(m.n_pecas).toBe(3);
		expect(m.n_piercings).toBe(3);
		expect(m.area_liquida_mm2).toBeCloseTo(18000, 6);
		expect(m.area_bruta_mm2).toBeCloseTo(18000, 6);
	});

	it('estoura 413 acima do teto de contornos', () => {
		const paths: CadPath[] = [];
		for (let i = 0; i < 12; i++) {
			paths.push(circle({ x: i * 10, y: 0 }, 2, 'CORTE'));
		}
		expect(() =>
			analyzeGeometry(sketchDe(paths), { maxContours: 10 }),
		).toThrowError(ToolEngineError);
		try {
			analyzeGeometry(sketchDe(paths), { maxContours: 10 });
		} catch (e) {
			expect((e as ToolEngineError).status).toBe(413);
		}
	});

	it('contorno em oito é sinalizado (a área do shoelace não vale)', () => {
		const oito = polyline(
			[
				{ x: 0, y: 0 },
				{ x: 100, y: 100 },
				{ x: 0, y: 100 },
				{ x: 100, y: 0 },
			],
			true,
			'CORTE',
		);
		const m = analyzeGeometry(sketchDe([oito]));
		const c = m.contornos[0];
		expect(c.autoIntersec).toBe(true);
	});

	it('peça muito recortada (dentes) NÃO é acusada de auto-interseção', () => {
		// O fecho convexo de um painel com dentes é bem maior que a área real; a
		// heurística sozinha acusaria. Por isso ela só levanta suspeita e o
		// veredito vem do teste de cruzamento.
		const pts: Pt[] = [{ x: 0, y: 0 }];
		for (let i = 0; i < 10; i++) {
			const x = i * 10;
			pts.push({ x: x + 5, y: 0 }, { x: x + 5, y: 20 }, { x: x + 10, y: 20 });
			pts.push({ x: x + 10, y: 0 });
		}
		pts.push({ x: 100, y: 30 }, { x: 0, y: 30 });
		const m = analyzeGeometry(sketchDe([polyline(pts, true, 'CORTE')]));
		expect(m.contornos[0].autoIntersec).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Duplicatas
// ---------------------------------------------------------------------------

describe('duplicatas', () => {
	it('detecta a linha desenhada em cima da outra com o comprimento certo', () => {
		const m = analyzeGeometry(
			sketchDe([
				...retanguloEmLinhas(0, 0, 100, 60),
				linha(0, 0, 100, 0), // cópia exata do lado de baixo
			]),
		);
		expect(m.duplicados.grupos).toBe(1);
		expect(m.duplicados.segmentos).toBe(1);
		expect(m.duplicados.comprimentoMm).toBeCloseTo(100, 9);
		// O comprimento cobrado hoje inclui a repetição — é por isso que o
		// profissional paga 2× sem saber.
		expect(m.comprimento_corte_mm).toBeCloseTo(420, 9);
		expect(m.comprimento_corte_limpo_mm).toBeCloseTo(320, 9);
		const d = porCodigo(diagnose(sketchDe([]), m), 'linha_duplicada');
		expect(d?.severity).toBe('aviso');
		expect(d?.count).toBe(1);
		expect(d?.message).toContain('100,00 mm');
	});

	it('cópia invertida (mesmas pontas, sentido trocado) também é duplicata', () => {
		const m = analyzeGeometry(
			sketchDe([linha(0, 0, 100, 0), linha(100, 0, 0, 0)]),
		);
		expect(m.duplicados.segmentos).toBe(1);
	});

	it('contorno duplicado NÃO vira "peça + furo do mesmo tamanho"', () => {
		// Se a cópia fosse aceita como furo da original, a área líquida daria ZERO e
		// o orçamento cobraria material nenhum. Quem contém é estritamente maior.
		const m = analyzeGeometry(
			sketchDe([rect(0, 0, 100, 60, 'CORTE'), rect(0, 0, 100, 60, 'CORTE')]),
		);
		expect(m.n_furos).toBe(0);
		expect(m.n_pecas).toBe(2);
		expect(m.area_liquida_mm2).toBeCloseTo(12000, 6);
		expect(m.duplicados.segmentos).toBe(1);
		expect(m.duplicados.comprimentoMm).toBeCloseTo(320, 9);
	});

	it('círculo duplicado conta o perímetro repetido', () => {
		const m = analyzeGeometry(
			sketchDe([
				circle({ x: 0, y: 0 }, 5, 'CORTE'),
				circle({ x: 0, y: 0 }, 5, 'CORTE'),
			]),
		);
		expect(m.duplicados.segmentos).toBe(1);
		expect(m.duplicados.comprimentoMm).toBeCloseTo(TAU * 5, 6);
	});

	it('arco e corda com as mesmas pontas NÃO são duplicata', () => {
		// O hash entra com tipo e comprimento de propósito: mandar apagar um arco
		// que não é cópia estragaria a peça do cliente.
		const m = analyzeGeometry(
			sketchDe([
				linha(-5, 0, 5, 0),
				{
					layer: 'CORTE',
					seg: {
						k: 'arc',
						c: { x: 0, y: 0 },
						r: 5,
						a0: Math.PI,
						a1: 0,
						ccw: false,
					},
				},
			]),
		);
		expect(m.duplicados.segmentos).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------------

describe('diagnose', () => {
	it('gap de 0,5 mm é "quase fechado", 5 mm é linha solta', () => {
		const quase = sketchDe([
			linha(0, 0, 100, 0),
			linha(100, 0, 100, 60),
			linha(100, 60, 0, 60),
			linha(0, 59.5, 0, 0), // falta 0,5 mm
		]);
		const d1 = diagnose(quase, analyzeGeometry(quase));
		const q = porCodigo(d1, 'contorno_quase_fechado');
		expect(q?.count).toBe(1);
		expect(q?.message).toContain('0,50 mm');
		expect(porCodigo(d1, 'linha_solta')).toBeUndefined();

		const solto = sketchDe([
			linha(0, 0, 100, 0),
			linha(100, 0, 100, 60),
			linha(100, 60, 0, 60),
			linha(0, 55, 0, 0), // falta 5 mm
		]);
		const d2 = diagnose(solto, analyzeGeometry(solto));
		expect(porCodigo(d2, 'contorno_quase_fechado')).toBeUndefined();
		expect(porCodigo(d2, 'linha_solta')?.count).toBe(1);
	});

	it('texto na camada de corte é avisado', () => {
		const sk = sketchDe([
			...retanguloEmLinhas(0, 0, 100, 60),
			text({ x: 10, y: 10 }, 'PROFISSÃO LASER', 8, 'CORTE'),
		]);
		const d = diagnose(sk, analyzeGeometry(sk));
		const t = porCodigo(d, 'texto_nao_vetorizado');
		expect(t?.count).toBe(1);
		expect(t?.message).toContain('vetor');
	});

	it('peça maior que a chapa só reclama se não couber nem girada 90°', () => {
		const sk = sketchDe(retanguloEmLinhas(0, 0, 1200, 400));
		const m = analyzeGeometry(sk);
		// Cabe girando: 1200×400 numa chapa 600×1300.
		expect(
			porCodigo(
				diagnose(sk, m, { chapa: { w: 600, h: 1300 } }),
				'peca_maior_que_chapa',
			),
		).toBeUndefined();
		const erro = porCodigo(
			diagnose(sk, m, { chapa: { w: 600, h: 900 } }),
			'peca_maior_que_chapa',
		);
		expect(erro?.severity).toBe('erro');
		expect(erro?.count).toBe(1);
	});

	it('furo menor que 1,2 × espessura avisa que pode não sair', () => {
		const sk = sketchDe([
			...retanguloEmLinhas(0, 0, 100, 60),
			circle({ x: 30, y: 30 }, 1.2, 'CORTE'), // Ø 2,4 mm
			circle({ x: 70, y: 30 }, 5, 'CORTE'),
		]);
		const m = analyzeGeometry(sk);
		const d = porCodigo(diagnose(sk, m, { espessura: 3 }), 'furo_pequeno');
		expect(d?.count).toBe(1);
		expect(d?.message).toContain('2,40 mm');
		// Sem espessura informada, o teste nem roda.
		expect(porCodigo(diagnose(sk, m), 'furo_pequeno')).toBeUndefined();
	});

	it('escala suspeita: DXF sem $INSUNITS e fora da faixa de chapa', () => {
		// 20 unidades de lado sem unidade declarada: o leitor conclui polegada.
		const dxf = dxfRetangulo(20, 10, null);
		const sk = readDxf(dxf);
		const d = diagnose(sk, analyzeGeometry(sk));
		const e = porCodigo(d, 'escala_suspeita');
		expect(e?.severity).toBe('aviso');
		expect(e?.message).toContain('25×');
	});

	it('desenho sem contorno fechado é erro, não silêncio', () => {
		const sk = sketchDe([linha(0, 0, 100, 0)]);
		const d = diagnose(sk, analyzeGeometry(sk));
		expect(porCodigo(d, 'sem_peca')?.severity).toBe('erro');
		// Erro vem antes de aviso e info na lista.
		expect(d[0].severity).toBe('erro');
	});

	it('bifurcação é reportada como geometria suja', () => {
		const sk = sketchDe([
			linha(0, 0, 50, 0),
			linha(50, 0, 100, 0),
			linha(50, 0, 50, 40),
		]);
		const { metrics, diagnostics } = analyzeAndDiagnose(sk);
		expect(metrics.bifurcacoes).toBe(1);
		expect(porCodigo(diagnostics, 'bifurcacao')?.count).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Integração: DXF real e caixa real
// ---------------------------------------------------------------------------

function dxfRetangulo(w: number, h: number, insunits: number | null): string {
	const linhas: string[] = [];
	const push = (c: number, v: string | number): void => {
		linhas.push(String(c), String(v));
	};
	push(0, 'SECTION');
	push(2, 'HEADER');
	if (insunits !== null) {
		push(9, '$INSUNITS');
		push(70, insunits);
	}
	push(0, 'ENDSEC');
	push(0, 'SECTION');
	push(2, 'ENTITIES');
	const cantos: Array<[number, number, number, number]> = [
		[0, 0, w, 0],
		[w, 0, w, h],
		[w, h, 0, h],
		[0, h, 0, 0],
	];
	for (const [x1, y1, x2, y2] of cantos) {
		push(0, 'LINE');
		push(8, '0');
		push(10, x1);
		push(20, y1);
		push(11, x2);
		push(21, y2);
	}
	push(0, 'ENDSEC');
	push(0, 'EOF');
	return `${linhas.join('\n')}\n`;
}

describe('integração', () => {
	it('DXF com o contorno picado em LINEs vira 1 peça fechada', () => {
		const sk = readDxf(dxfRetangulo(100, 60, 4));
		const m = analyzeGeometry(sk);
		expect(m.n_pecas).toBe(1);
		expect(m.n_abertos).toBe(0);
		expect(m.n_piercings).toBe(1);
		expect(m.area_liquida_mm2).toBeCloseTo(6000, 6);
		expect(m.comprimento_corte_mm).toBeCloseTo(320, 6);
	});

	it('caixa real do gerador: comprimento de corte bate com meta.stats', () => {
		const sk = buildBox({
			largura: 120,
			profundidade: 80,
			altura: 60,
			espessura: 3,
			tampa: 'encaixe',
			fundo: true,
			div_x: 1,
		});
		const m = analyzeGeometry(sk);
		const esperado = sk.meta.stats.cutLengthMm;
		expect(esperado).toBeGreaterThan(0);
		// Encadear não pode criar nem perder comprimento: 0,1% é a folga pedida, a
		// igualdade real é exata (a diferença medida é ~1e-12 mm).
		expect(Math.abs(m.comprimento_corte_mm - esperado) / esperado).toBeLessThan(
			0.001,
		);
		expect(m.comprimento_corte_mm).toBeCloseTo(esperado, 9);
		expect(m.n_piercings).toBe(sk.meta.stats.pierces);
		expect(m.area_bruta_mm2).toBeCloseTo(sk.meta.stats.areaMm2, 6);
		// Cada painel é uma peça fechada; nada de contorno aberto num arquivo gerado.
		expect(m.n_pecas).toBe(sk.parts.length);
		expect(m.n_abertos).toBe(0);
		expect(m.degenerados).toBe(0);
		// A área líquida de cada painel é menor que a bruta (os rasgos são furos)
		// e maior que zero.
		for (const p of m.pecas) {
			expect(p.areaLiquidaMm2).toBeGreaterThan(0);
			expect(p.areaLiquidaMm2).toBeLessThanOrEqual(p.areaBrutaMm2 + 1e-6);
		}
		// Arquivo gerado é limpo: nenhuma cópia empilhada e nenhuma bifurcação.
		expect(m.duplicados.segmentos).toBe(0);
		expect(m.bifurcacoes).toBe(0);
		expect(m.comprimento_gravacao_mm).toBeCloseTo(
			sk.meta.stats.engraveLengthMm,
			6,
		);
	});

	it('caixa real: sem diagnóstico de erro', () => {
		const sk = buildBox({
			largura: 100,
			profundidade: 100,
			altura: 50,
			espessura: 3,
		});
		const { diagnostics } = analyzeAndDiagnose(sk, {
			chapa: { w: 600, h: 400 },
			espessura: 3,
		});
		expect(diagnostics.filter((d) => d.severity === 'erro')).toHaveLength(0);
	});
});
