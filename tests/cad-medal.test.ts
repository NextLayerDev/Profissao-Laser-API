import { describe, expect, it } from 'vitest';
import {
	ARO_RECUO_EXTERNO,
	ARO_RECUO_INTERNO,
	buildMedal,
	DIAMETRO_MIN,
	ESTRELA_RAIO_INTERNO,
	FURO_MARGEM_FATOR,
	FURO_MARGEM_MIN,
	type MedalForma,
	type MedalParams,
	QTD_MAX,
} from '@/lib/cad/generators/medal.js';
import type { CadPath, Part, Pt, Sketch2D } from '@/lib/cad/ir.js';

const TOL = 1e-6;

/** Medalha de referência: disco de 40 mm em MDF de 3 mm. */
const BASE: MedalParams = {
	diametro: 40,
	espessura: 3,
	material: 'mdf',
	kerf: 0.15,
	forma: 'disco',
	furo_fita_diametro: 4,
	furo_distancia_borda: 8,
};

function peca(sk: Sketch2D): Part {
	const p = sk.parts[0];
	if (!p) throw new Error('medalha não gerada');
	return p;
}

function porId(sk: Sketch2D, id: string): CadPath {
	const p = peca(sk).paths.find((x) => x.id === id);
	if (!p) throw new Error(`caminho "${id}" não gerado`);
	return p;
}

function raioDe(path: CadPath): number {
	if (path.seg.k !== 'circle') throw new Error('não é círculo');
	return path.seg.r;
}

/**
 * Centro da medalha em coordenadas locais. NÃO é o centro da caixa: numa estrela
 * de 5 pontas a caixa sobra mais acima do centro que abaixo.
 */
function centroDe(sk: Sketch2D): Pt {
	return sk.meta.params.centro as Pt;
}

/** Furo da fita medido a partir do centro da peça. */
function furoRelativo(sk: Sketch2D): { dx: number; dy: number; r: number } {
	const furo = porId(sk, 'furo_fita');
	if (furo.seg.k !== 'circle') throw new Error('furo não é círculo');
	const c = centroDe(sk);
	return { dx: furo.seg.c.x - c.x, dy: furo.seg.c.y - c.y, r: furo.seg.r };
}

function pontosContorno(sk: Sketch2D): Pt[] {
	const c = porId(sk, 'contorno');
	if (c.seg.k !== 'poly') throw new Error('contorno não é polilinha');
	expect(c.seg.closed).toBe(true);
	return c.seg.pts;
}

// ---------------------------------------------------------------------------

describe('medalha — furo da fita: desenhado vs final', () => {
	const k = 0.15;
	const d = 4;

	it('o furo desenhado é menor que o nominal e sai nominal depois do corte', () => {
		const sk = buildMedal({ ...BASE, kerf: k, furo_fita_diametro: d });
		const desenhado = 2 * furoRelativo(sk).r;
		// O feixe alarga o vazio em k/2 de cada lado: desenhado + k = final.
		expect(desenhado).toBeCloseTo(d - k, 9);
		expect(desenhado + k).toBeCloseTo(d, 9);
		expect(sk.meta.params.furo_diametro_desenhado).toBeCloseTo(d - k, 9);
	});

	it('o contorno é desenhado MAIOR para sair com o Ø pedido', () => {
		const sk = buildMedal({ ...BASE, kerf: k });
		const desenhado = 2 * raioDe(porId(sk, 'contorno'));
		expect(desenhado).toBeCloseTo(40 + k, 9);
		expect(desenhado - k).toBeCloseTo(40, 9);
	});

	it('o centro do furo se mede na borda FINAL, não na desenhada', () => {
		const dist = 8;
		const sk = buildMedal({ ...BASE, kerf: k, furo_distancia_borda: dist });
		const { dx, dy } = furoRelativo(sk);
		expect(dx).toBeCloseTo(0, 9);
		// Borda final = raio nominal (20). Usar a borda desenhada (20 + k/2) erraria
		// a distância furo↔borda em k/2.
		expect(dy).toBeCloseTo(20 - dist, 9);
		// A folga real entre o furo pronto e a borda pronta é dist − Ø/2.
		const folgaFinal = 20 - dy - (2 * furoRelativo(sk).r + k) / 2;
		expect(folgaFinal).toBeCloseTo(dist - 4 / 2, 9);
	});

	it('kerf zero não move nada', () => {
		const sk = buildMedal({ ...BASE, kerf: 0 });
		expect(2 * raioDe(porId(sk, 'contorno'))).toBeCloseTo(40, 9);
		expect(2 * furoRelativo(sk).r).toBeCloseTo(4, 9);
	});

	it('furo que sumiria dentro do kerf é rejeitado', () => {
		expect(() =>
			buildMedal({
				...BASE,
				kerf: 0.6,
				furo_fita_diametro: 0.8,
				furo_distancia_borda: 3,
			}),
		).toThrow(/some com o kerf/);
	});
});

describe('medalha — invariantes do furo perto da borda', () => {
	it('rejeita furo com menos de 1,5 Ø de distância à borda', () => {
		const d = 6;
		expect(() =>
			buildMedal({
				...BASE,
				furo_fita_diametro: d,
				furo_distancia_borda: FURO_MARGEM_FATOR * d - 0.5,
			}),
		).toThrow(/racha a medalha/);
	});

	it('aceita exatamente 1,5 Ø', () => {
		const d = 6;
		expect(() =>
			buildMedal({
				...BASE,
				furo_fita_diametro: d,
				furo_distancia_borda: FURO_MARGEM_FATOR * d,
			}),
		).not.toThrow();
	});

	it('rejeita menos de 3 mm mesmo com furo minúsculo', () => {
		// 1,5 × 1,5 = 2,25 mm passaria pelo fator; o piso absoluto é que segura.
		expect(() =>
			buildMedal({
				...BASE,
				furo_fita_diametro: 1.5,
				furo_distancia_borda: 2.9,
			}),
		).toThrow(/racha a medalha/);
		expect(() =>
			buildMedal({
				...BASE,
				furo_fita_diametro: 1.5,
				furo_distancia_borda: FURO_MARGEM_MIN,
			}),
		).not.toThrow();
	});

	it('rejeita furo tão fundo que cai no centro da peça', () => {
		expect(() => buildMedal({ ...BASE, furo_distancia_borda: 20 })).toThrow(
			/cairia no centro/,
		);
	});

	it('avisa quando a ponte real de material é fina, mesmo com parâmetro legal', () => {
		// Na ponta da estrela o contorno se fecha em volta do furo: o parâmetro está
		// dentro da regra, mas sobra menos material do que ele promete.
		const sk = buildMedal({
			...BASE,
			forma: 'estrela',
			lados: 5,
			furo_fita_diametro: 4,
			furo_distancia_borda: 8,
		});
		expect(sk.meta.warnings.join(' ')).toMatch(/material em volta do furo/);
		// O mesmo furo num disco não tem por que avisar.
		const disco = buildMedal({ ...BASE });
		expect(disco.meta.warnings).toHaveLength(0);
	});

	it('acrílico ganha aviso de margem apertada', () => {
		const sk = buildMedal({
			...BASE,
			material: 'acrilico',
			furo_fita_diametro: 4,
			furo_distancia_borda: 7,
		});
		expect(sk.meta.warnings.join(' ')).toMatch(/Acrílico trinca/);
	});

	it('Ø de furo zero produz ficha sem furo', () => {
		const sk = buildMedal({ ...BASE, furo_fita_diametro: 0 });
		expect(peca(sk).paths.some((p) => p.id === 'furo_fita')).toBe(false);
		expect(sk.meta.warnings.join(' ')).toMatch(/ficha\/token/);
	});
});

describe('medalha — as quatro formas', () => {
	const casos: Array<{
		forma: MedalForma;
		lados?: number;
		vertices: number;
	}> = [
		{ forma: 'poligono', lados: 6, vertices: 6 },
		{ forma: 'poligono', lados: 3, vertices: 3 },
		{ forma: 'poligono', lados: 12, vertices: 12 },
		{ forma: 'estrela', lados: 5, vertices: 10 },
		{ forma: 'estrela', lados: 3, vertices: 6 },
		{ forma: 'escudo', vertices: 6 },
	];

	for (const caso of casos) {
		const nome = caso.lados ? `${caso.forma} de ${caso.lados}` : caso.forma;
		it(`${nome} fecha o contorno com ${caso.vertices} vértices`, () => {
			const sk = buildMedal({
				...BASE,
				forma: caso.forma,
				...(caso.lados ? { lados: caso.lados } : {}),
			});
			const pts = pontosContorno(sk);
			expect(pts).toHaveLength(caso.vertices);
			expect(sk.meta.params.vertices).toBe(caso.vertices);
			// Nenhum vértice repetido: polilinha com vértice duplo trava alguns CAMs.
			for (let i = 0; i < pts.length; i++) {
				const a = pts[i];
				const b = pts[(i + 1) % pts.length];
				expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1e-3);
			}
		});
	}

	it('o disco é um círculo, não uma polilinha facetada', () => {
		const sk = buildMedal({ ...BASE, forma: 'disco' });
		expect(porId(sk, 'contorno').seg.k).toBe('circle');
		expect(sk.meta.params.vertices).toBe(0);
	});

	it('a estrela alterna raio externo e interno de 0,45', () => {
		const sk = buildMedal({ ...BASE, forma: 'estrela', lados: 5, kerf: 0 });
		const pts = pontosContorno(sk);
		const c = centroDe(sk);
		const raios = pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
		for (let i = 0; i < raios.length; i++) {
			const esperado = i % 2 === 0 ? 20 : 20 * ESTRELA_RAIO_INTERNO;
			expect(raios[i]).toBeCloseTo(esperado, 6);
		}
	});

	it('o polígono é compensado perpendicular à aresta, não no raio', () => {
		const k = 0.4;
		const lados = 6;
		const sk = buildMedal({ ...BASE, forma: 'poligono', lados, kerf: k });
		const pts = pontosContorno(sk);
		const c = centroDe(sk);
		const raio = Math.hypot(pts[0].x - c.x, pts[0].y - c.y);
		// Empurrar cada aresta k/2 para fora move o vértice (k/2)/cos(π/n) no raio.
		expect(raio).toBeCloseTo(20 + k / 2 / Math.cos(Math.PI / lados), 6);
		// E o apótema — a medida que o feixe realmente controla — volta ao nominal.
		const apotemaFinal = raio * Math.cos(Math.PI / lados) - k / 2;
		expect(apotemaFinal).toBeCloseTo(20 * Math.cos(Math.PI / lados), 6);
	});

	it('a ponta do escudo é arco (bulge), não bico cortado', () => {
		const sk = buildMedal({ ...BASE, forma: 'escudo' });
		const c = porId(sk, 'contorno');
		if (c.seg.k !== 'poly') throw new Error('contorno não é polilinha');
		const bulges = c.seg.bulges ?? [];
		expect(bulges.filter((b) => Math.abs(b) > TOL)).toHaveLength(1);
		// Arco convexo num contorno anti-horário ⇒ bulge positivo.
		expect(bulges[1]).toBeGreaterThan(0);
		// Topo reto de ponta a ponta.
		expect(c.seg.pts[4].y).toBeCloseTo(c.seg.pts[5].y, 9);
	});

	it('toda forma entrega a peça com a origem no canto da caixa', () => {
		for (const forma of ['disco', 'poligono', 'estrela', 'escudo'] as const) {
			const sk = buildMedal({ ...BASE, forma });
			for (const p of pontosContorno0(sk)) {
				expect(p.x).toBeGreaterThan(-1e-6);
				expect(p.y).toBeGreaterThan(-1e-6);
			}
		}
	});

	/** Pontos extremos do contorno, seja círculo ou polilinha. */
	function pontosContorno0(sk: Sketch2D): Pt[] {
		const c = porId(sk, 'contorno');
		if (c.seg.k === 'circle') {
			return [
				{ x: c.seg.c.x - c.seg.r, y: c.seg.c.y - c.seg.r },
				{ x: c.seg.c.x + c.seg.r, y: c.seg.c.y + c.seg.r },
			];
		}
		if (c.seg.k !== 'poly') throw new Error('contorno inesperado');
		return c.seg.pts;
	}

	it('lados fora de 3–12 é rejeitado e ignorado nas formas sem lados', () => {
		expect(() => buildMedal({ ...BASE, forma: 'poligono', lados: 2 })).toThrow(
			/lados/,
		);
		expect(() => buildMedal({ ...BASE, forma: 'estrela', lados: 13 })).toThrow(
			/pontas/,
		);
		const sk = buildMedal({ ...BASE, forma: 'disco', lados: 7 });
		expect(sk.meta.warnings.join(' ')).toMatch(/só vale para polígono/);
		expect(sk.meta.params.lados).toBe(0);
	});
});

describe('medalha — aro gravado', () => {
	it('o aro duplo são dois círculos em R−2 e R−3,2, na GRAVACAO', () => {
		const sk = buildMedal({ ...BASE, aro: 'duplo' });
		expect(raioDe(porId(sk, 'aro_externo'))).toBeCloseTo(
			20 - ARO_RECUO_EXTERNO,
			9,
		);
		expect(raioDe(porId(sk, 'aro_interno'))).toBeCloseTo(
			20 - ARO_RECUO_INTERNO,
			9,
		);
		expect(porId(sk, 'aro_externo').layer).toBe('GRAVACAO');
		expect(porId(sk, 'aro_interno').layer).toBe('GRAVACAO');
	});

	it('o aro simples é um círculo só', () => {
		const sk = buildMedal({ ...BASE, aro: 'simples' });
		expect(raioDe(porId(sk, 'aro_externo'))).toBeCloseTo(
			20 - ARO_RECUO_EXTERNO,
			9,
		);
		expect(peca(sk).paths.some((p) => p.id === 'aro_interno')).toBe(false);
	});

	it('aro NUNCA vai para a layer CORTE, em nenhuma forma', () => {
		for (const forma of ['disco', 'poligono', 'estrela', 'escudo'] as const) {
			for (const aro of ['simples', 'duplo'] as const) {
				const sk = buildMedal({ ...BASE, forma, aro });
				const aros = peca(sk).paths.filter((p) =>
					(p.id ?? '').startsWith('aro_'),
				);
				expect(aros.length).toBeGreaterThan(0);
				for (const a of aros) {
					expect(a.layer).toBe('GRAVACAO');
					expect(a.layer).not.toBe('CORTE');
				}
				// Só o contorno e o furo são corte.
				const corte = peca(sk)
					.paths.filter((p) => p.layer === 'CORTE')
					.map((p) => p.id);
				expect(corte).toEqual(['contorno', 'furo_fita']);
			}
		}
	});

	it('o aro cabe dentro da forma: numa estrela ele encolhe para o raio inscrito', () => {
		const sk = buildMedal({
			...BASE,
			forma: 'estrela',
			lados: 5,
			aro: 'duplo',
		});
		const inscrito = 20 * ESTRELA_RAIO_INTERNO;
		expect(sk.meta.params.raio_inscrito).toBeCloseTo(inscrito, 6);
		// Um aro de R−2 = 18 sairia pela ponta e gravaria a mesa da máquina.
		expect(raioDe(porId(sk, 'aro_externo'))).toBeCloseTo(
			inscrito - ARO_RECUO_EXTERNO,
			6,
		);
		expect(raioDe(porId(sk, 'aro_externo'))).toBeLessThan(18);
	});

	it('sem aro não há círculo de gravação', () => {
		const sk = buildMedal({ ...BASE, aro: 'nenhum' });
		expect(peca(sk).paths.some((p) => (p.id ?? '').startsWith('aro_'))).toBe(
			false,
		);
	});
});

describe('medalha — gravação de texto', () => {
	it('as duas linhas ficam centradas, na GRAVACAO, a segunda abaixo', () => {
		const sk = buildMedal({
			...BASE,
			gravacao_texto: 'CAMPEAO',
			gravacao_texto2: '2026',
			gravacao_altura: 5,
		});
		const l1 = porId(sk, 'gravacao_1');
		const l2 = porId(sk, 'gravacao_2');
		if (l1.seg.k !== 'text' || l2.seg.k !== 'text')
			throw new Error('gravação não é texto');
		expect(l1.layer).toBe('GRAVACAO');
		expect(l2.layer).toBe('GRAVACAO');
		expect(l1.seg.anchor).toBe('c');
		expect(l2.seg.at.y).toBeLessThan(l1.seg.at.y);
		expect(l1.seg.h).toBe(l2.seg.h);
		const c = centroDe(sk);
		expect(l1.seg.at.x).toBeCloseTo(c.x, 9);
		// Bloco de duas linhas simétrico em torno do centro da peça.
		const centroBloco = (l1.seg.at.y + l1.seg.h + l2.seg.at.y) / 2;
		expect(centroBloco).toBeCloseTo(c.y, 6);
	});

	it('só a segunda linha preenchida vira a linha única', () => {
		const sk = buildMedal({ ...BASE, gravacao_texto2: 'PRATA' });
		expect(peca(sk).paths.some((p) => p.id === 'gravacao_1')).toBe(true);
		expect(peca(sk).paths.some((p) => p.id === 'gravacao_2')).toBe(false);
	});

	it('texto longo encolhe para caber e avisa quando fica ilegível', () => {
		const sk = buildMedal({
			...BASE,
			diametro: 25,
			gravacao_texto: 'CAMPEONATO ESTADUAL DE VELOCIDADE 2026',
			gravacao_altura: 8,
		});
		const g = porId(sk, 'gravacao_1');
		if (g.seg.k !== 'text') throw new Error('gravação não é texto');
		expect(g.seg.h).toBeLessThan(8);
		expect(sk.meta.warnings.join(' ')).toMatch(/borrão/);
		// Mesmo encolhido, o texto não escapa da peça.
		expect(g.seg.h * g.seg.text.length * 0.62).toBeLessThanOrEqual(25);
	});

	it('sem texto não há caminho de gravação de texto', () => {
		const sk = buildMedal({ ...BASE, gravacao_texto: '   ' });
		expect(
			peca(sk).paths.some((p) => (p.id ?? '').startsWith('gravacao_')),
		).toBe(false);
		expect(sk.meta.params.gravacao_altura).toBe(0);
	});
});

describe('medalha — limites e quantidade', () => {
	it(`rejeita diâmetro abaixo de ${DIAMETRO_MIN} mm`, () => {
		expect(() => buildMedal({ ...BASE, diametro: DIAMETRO_MIN - 0.1 })).toThrow(
			/pequena demais/,
		);
		expect(() => buildMedal({ ...BASE, diametro: 10 })).toThrow(
			/pequena demais/,
		);
		expect(() => buildMedal({ ...BASE, diametro: DIAMETRO_MIN })).not.toThrow();
	});

	it('rejeita espessura, kerf e material inválidos', () => {
		expect(() => buildMedal({ ...BASE, espessura: 0 })).toThrow(/espessura/);
		expect(() => buildMedal({ ...BASE, kerf: -1 })).toThrow(/kerf/);
		// Feixe mais largo que a chapa: não existe peça.
		expect(() => buildMedal({ ...BASE, espessura: 0.1, kerf: 0.2 })).toThrow(
			/kerf/,
		);
		expect(() => buildMedal({ ...BASE, material: 'papel' as never })).toThrow(
			/Material desconhecido/,
		);
		expect(() => buildMedal({ ...BASE, forma: 'losango' as never })).toThrow(
			/Forma desconhecida/,
		);
		expect(() => buildMedal({ ...BASE, aro: 'triplo' as never })).toThrow(
			/Aro desconhecido/,
		);
	});

	it('qtd propaga para stats.partCount e para a área', () => {
		const um = buildMedal({ ...BASE, qtd: 1 });
		const trinta = buildMedal({ ...BASE, qtd: 30 });
		expect(peca(trinta).qty).toBe(30);
		expect(trinta.meta.stats.partCount).toBe(30);
		expect(um.meta.stats.partCount).toBe(1);
		expect(trinta.meta.stats.areaMm2).toBeCloseTo(
			30 * um.meta.stats.areaMm2,
			6,
		);
		expect(trinta.meta.stats.cutLengthMm).toBeCloseTo(
			30 * um.meta.stats.cutLengthMm,
			6,
		);
		// Uma peça distinta, trinta instâncias: o nesting é quem expande.
		expect(trinta.parts).toHaveLength(1);
	});

	it('qtd inválida ou acima do teto é rejeitada', () => {
		expect(() => buildMedal({ ...BASE, qtd: 0 })).toThrow(/quantidade/i);
		expect(() => buildMedal({ ...BASE, qtd: QTD_MAX + 1 })).toThrow(/teto/);
		expect(() => buildMedal({ ...BASE, qtd: QTD_MAX })).not.toThrow();
	});

	it('a caixa envolvente cobre a gravação, não só o corte', () => {
		const sk = buildMedal({ ...BASE, aro: 'duplo', gravacao_texto: 'OURO' });
		const { w, h } = peca(sk).bbox;
		// Disco de 40 desenhado com kerf 0,15 mede 40,15 nos dois eixos.
		expect(w).toBeCloseTo(40.15, 6);
		expect(h).toBeCloseTo(40.15, 6);
	});

	it('meta descreve a peça de ponta a ponta', () => {
		const sk = buildMedal({ ...BASE, forma: 'escudo', aro: 'simples', qtd: 4 });
		expect(sk.meta.generator).toBe('cad/medal@1');
		expect(sk.units).toBe('mm');
		expect(sk.meta.kerf).toBe(0.15);
		expect(sk.meta.clearance).toBe(0);
		expect(sk.meta.params.forma).toBe('escudo');
		expect(sk.meta.params.qtd).toBe(4);
		expect(sk.meta.params.raio_nominal).toBe(20);
		expect(peca(sk).thickness).toBe(3);
		expect(peca(sk).material).toBe('mdf');
	});
});
