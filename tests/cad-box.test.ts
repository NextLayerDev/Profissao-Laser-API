import { describe, expect, it } from 'vitest';
import { type BoxParams, buildBox } from '@/lib/cad/generators/box.js';
import type { CadPath, Part, Pt } from '@/lib/cad/ir.js';
import { fingerGeometry } from '@/lib/cad/kerf.js';

const TOL = 1e-6;

/** Contorno externo da peça (o primeiro caminho de CORTE é sempre o contorno). */
function contornoDe(part: Part): Pt[] {
	const path = part.paths.find(
		(p: CadPath) => p.layer === 'CORTE' && p.seg.k === 'poly',
	);
	if (!path || path.seg.k !== 'poly') throw new Error('sem contorno');
	return path.seg.pts;
}

/**
 * Trechos da aresta ESQUERDA (x = 0) do painel que estão à distância `x` do
 * bordo: com x = 0 saem os DENTES, com x = profundidade da fenda saem as FENDAS.
 * Percorre o contorno como polilinha fechada (o último segmento volta ao
 * primeiro ponto — é lá que mora a fenda/dente que encosta no canto de baixo).
 */
function trechosVerticais(pts: Pt[], x: number): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (let i = 0; i < pts.length; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % pts.length];
		if (Math.abs(a.x - x) > 1e-4 || Math.abs(b.x - x) > 1e-4) continue;
		if (Math.abs(a.y - b.y) <= 1e-4) continue;
		out.push([Math.min(a.y, b.y), Math.max(a.y, b.y)]);
	}
	return out.sort((p, q) => p[0] - q[0]);
}

function pecaPorId(sk: ReturnType<typeof buildBox>, id: string): Part {
	const p = sk.parts.find((x) => x.id === id);
	if (!p) throw new Error(`peça "${id}" não gerada`);
	return p;
}

const BASE: BoxParams = {
	dim_mode: 'interno',
	largura: 200,
	profundidade: 150,
	altura: 80,
	espessura: 3,
	kerf: 0.15,
	folga: 0.1,
	fundo: true,
	tampa: 'nenhuma',
};

describe('caixa — montagem do encaixe vertical', () => {
	const t = 3;
	const k = 0.15;
	const c = 0.1;
	const sk = buildBox(BASE);
	const Hp = 80 + 2 * t; // altura externa = interna + 2t
	const fg = fingerGeometry({
		L: Hp,
		t,
		tOposta: t,
		k,
		c,
		alvo: Math.max(3 * t, 8),
	});
	const prof = fg.fendaProf;

	const frente = pecaPorId(sk, 'frente');
	const esquerda = pecaPorId(sk, 'esquerda');

	it('a frente manda no canto: dente nas duas pontas da aresta vertical', () => {
		const dentes = trechosVerticais(contornoDe(frente), 0);
		expect(dentes.length).toBe((fg.n + 1) / 2);
		expect(dentes[0][0]).toBeCloseTo(0, 6);
		expect(dentes[dentes.length - 1][1]).toBeCloseTo(Hp, 6);
	});

	it('nº de dentes da frente === nº de fendas da lateral vizinha', () => {
		const dentes = trechosVerticais(contornoDe(frente), 0);
		const fendas = trechosVerticais(contornoDe(esquerda), prof);
		expect(fendas.length).toBe(dentes.length);
		// E as bandas casam uma a uma: onde a frente tem material, a lateral cedeu.
		for (let i = 0; i < dentes.length; i++) {
			const meioDente = (dentes[i][0] + dentes[i][1]) / 2;
			const meioFenda = (fendas[i][0] + fendas[i][1]) / 2;
			expect(Math.abs(meioDente - meioFenda)).toBeLessThan(fg.p / 2);
		}
	});

	it('a folga resultante do par dente/fenda é exatamente c', () => {
		const dentes = trechosVerticais(contornoDe(frente), 0);
		const fendas = trechosVerticais(contornoDe(esquerda), prof);
		// Só os pares INTERNOS formam bolso fechado; os das pontas são fronteira
		// única (e por isso valem meia folga de cada lado).
		const denteInterno = dentes[1];
		const fendaInterna = fendas[1];
		const larguraDenteDesenhada = denteInterno[1] - denteInterno[0];
		const larguraFendaDesenhada = fendaInterna[1] - fendaInterna[0];
		expect(larguraDenteDesenhada).toBeCloseTo(fg.denteLargura, 6);
		expect(larguraFendaDesenhada).toBeCloseTo(fg.fendaLargura, 6);
		// O feixe come k do dente e alarga k a fenda: é aí que a folga aparece.
		const denteFinal = larguraDenteDesenhada - k;
		const fendaFinal = larguraFendaDesenhada + k;
		expect(fendaFinal - denteFinal).toBeCloseTo(c, 9);
	});

	it('a coluna do canto fecha: frente e lateral se alternam com folga c/2', () => {
		// Prova de montagem de verdade. No cubo do canto vertical só cabe UM painel
		// por vez; depois do kerf (cada dente perde k/2 de cada lado), os dentes das
		// duas peças têm de se alternar cobrindo os 86 mm sem sobrar nem faltar,
		// com a mesma fresta em toda fronteira. Sobreposição = caixa que não fecha;
		// fresta maior = canto aberto.
		const dentes = [
			...trechosVerticais(contornoDe(frente), 0).map(([a, b]) => ({
				a: a + k / 2,
				b: b - k / 2,
				peca: 'frente',
			})),
			...trechosVerticais(contornoDe(esquerda), 0).map(([a, b]) => ({
				a: a + k / 2,
				b: b - k / 2,
				peca: 'esquerda',
			})),
		].sort((p, q) => p.a - q.a);

		expect(dentes).toHaveLength(fg.n);
		expect(dentes[0].a).toBeCloseTo(k / 2, 9);
		expect(dentes[dentes.length - 1].b).toBeCloseTo(Hp - k / 2, 9);
		for (let i = 0; i < dentes.length - 1; i++) {
			expect(dentes[i].peca).not.toBe(dentes[i + 1].peca);
			expect(dentes[i + 1].a - dentes[i].b).toBeCloseTo(c / 2, 9);
		}
	});

	it('a lateral cede as duas pontas (fenda encostando nos cantos)', () => {
		const fendas = trechosVerticais(contornoDe(esquerda), prof);
		expect(fendas[0][0]).toBeCloseTo(0, 6);
		expect(fendas[fendas.length - 1][1]).toBeCloseTo(Hp, 6);
	});

	it('o par frente/fundo usa a mesma contagem nas duas peças', () => {
		const fgW = fingerGeometry({
			L: 206,
			t,
			tOposta: t,
			k,
			c,
			alvo: Math.max(3 * t, 8),
		});
		// Aresta de baixo da frente: dentes; aresta da frente do fundo: fendas.
		const dentesBaixo = contornoDe(frente).filter((p) => Math.abs(p.y) <= TOL);
		const fundo = pecaPorId(sk, 'fundo');
		const fendasFrente = contornoDe(fundo).filter(
			(p) => Math.abs(p.y - fgW.fendaProf) <= 1e-4,
		);
		expect(dentesBaixo.length).toBeGreaterThan(0);
		expect(fendasFrente.length).toBeGreaterThan(0);
		expect(fgW.n % 2).toBe(1);
	});
});

describe('caixa — dimensões', () => {
	it('interno + 2t === externo: as duas entradas geram a mesma caixa', () => {
		const interno = buildBox(BASE);
		const externo = buildBox({
			...BASE,
			dim_mode: 'externo',
			largura: 206,
			profundidade: 156,
			altura: 86,
		});
		expect(externo.parts.map((p) => p.id)).toEqual(
			interno.parts.map((p) => p.id),
		);
		for (let i = 0; i < interno.parts.length; i++) {
			expect(externo.parts[i].bbox.w).toBeCloseTo(interno.parts[i].bbox.w, 9);
			expect(externo.parts[i].bbox.h).toBeCloseTo(interno.parts[i].bbox.h, 9);
		}
	});

	it('o fundo tem o footprint externo e as paredes a altura externa', () => {
		const sk = buildBox(BASE);
		const fundo = pecaPorId(sk, 'fundo');
		expect(fundo.bbox.w).toBeCloseTo(206, 6);
		expect(fundo.bbox.h).toBeCloseTo(156, 6);
		const frente = pecaPorId(sk, 'frente');
		expect(frente.bbox.w).toBeCloseTo(206, 6);
		expect(frente.bbox.h).toBeCloseTo(86, 6);
		const esquerda = pecaPorId(sk, 'esquerda');
		expect(esquerda.bbox.w).toBeCloseTo(156, 6);
		expect(esquerda.bbox.h).toBeCloseTo(86, 6);
	});

	it('a tampa solta se apoia nas paredes e encurta a parede em t', () => {
		const sk = buildBox({ ...BASE, tampa: 'solta' });
		expect(pecaPorId(sk, 'frente').bbox.h).toBeCloseTo(86 - 3, 6);
		expect(pecaPorId(sk, 'tampa').bbox.w).toBeCloseTo(206, 6);
	});

	it('espessura que come o vão interno é erro 400', () => {
		expect(() =>
			buildBox({ ...BASE, dim_mode: 'externo', largura: 5, espessura: 3 }),
		).toThrow(/não cabe/i);
	});
});

describe('caixa — aresta curta cai para topo colado', () => {
	const sk = buildBox({
		...BASE,
		dim_mode: 'externo',
		largura: 12,
		profundidade: 12,
		altura: 12,
		espessura: 2,
	});

	it('emite aviso em PT-BR e troca o encaixe', () => {
		expect(sk.meta.params.encaixe).toBe('topo_colado');
		expect(sk.meta.warnings.some((w) => /topo colado/i.test(w))).toBe(true);
	});

	it('os painéis viram retângulos limpos (4 vértices, sem dente)', () => {
		for (const part of sk.parts) {
			expect(contornoDe(part)).toHaveLength(4);
		}
		// Laterais entram ENTRE frente e trás quando não há dente.
		expect(pecaPorId(sk, 'esquerda').bbox.w).toBeCloseTo(12 - 2 * 2, 6);
	});
});

describe('caixa — estatísticas, tampa e divisórias', () => {
	it('stats saem preenchidas e coerentes', () => {
		const sk = buildBox(BASE);
		expect(sk.meta.stats.cutLengthMm).toBeGreaterThan(0);
		expect(sk.meta.stats.partCount).toBe(sk.parts.length);
		expect(sk.meta.stats.pierces).toBeGreaterThanOrEqual(sk.parts.length);
		expect(sk.meta.stats.areaMm2).toBeGreaterThan(0);
		expect(sk.units).toBe('mm');
		expect(sk.meta.kerf).toBe(0.15);
		expect(sk.meta.clearance).toBe(0.1);
	});

	it('cada peça sai com pose para a montagem 3D', () => {
		const sk = buildBox({ ...BASE, tampa: 'encaixe', div_x: 1, div_y: 1 });
		for (const part of sk.parts) {
			expect(part.pose).toBeDefined();
			expect(part.pose?.pos).toHaveLength(3);
			expect(part.pose?.rot).toHaveLength(3);
		}
	});

	it('gravação da tampa vai na layer GRAVACAO, centralizada', () => {
		const sk = buildBox({
			...BASE,
			tampa: 'solta',
			gravacao_tampa: 'PROFISSÃO LASER',
		});
		const tampa = pecaPorId(sk, 'tampa');
		const grav = tampa.paths.find((p) => p.layer === 'GRAVACAO');
		expect(grav).toBeDefined();
		if (grav?.seg.k !== 'text') throw new Error('gravação não é texto');
		expect(grav.seg.text).toBe('PROFISSÃO LASER');
		expect(grav.seg.anchor).toBe('c');
		expect(grav.seg.at.x).toBeCloseTo(tampa.bbox.w / 2, 6);
	});

	it('gravação sem tampa vira aviso, não erro', () => {
		const sk = buildBox({ ...BASE, tampa: 'nenhuma', gravacao_tampa: 'oi' });
		expect(sk.meta.warnings.some((w) => /gravação/i.test(w))).toBe(true);
	});

	it('divisórias geram as peças e os rasgos nas faces', () => {
		const sk = buildBox({ ...BASE, div_x: 2, div_y: 1 });
		expect(pecaPorId(sk, 'div_x_0')).toBeTruthy();
		expect(pecaPorId(sk, 'div_x_1')).toBeTruthy();
		expect(pecaPorId(sk, 'div_y_0')).toBeTruthy();
		// A frente recebe bolsos para os dentes das duas divisórias verticais.
		const frente = pecaPorId(sk, 'frente');
		const bolsos = frente.paths.filter(
			(p, i) => i > 0 && p.layer === 'CORTE' && p.seg.k === 'poly',
		);
		expect(bolsos.length).toBeGreaterThan(0);
		expect(bolsos.length % 2).toBe(0); // mesmo nº de bolsos para cada divisória
	});

	it('tampa deslizante rebaixa a frente e abre rasgo nas 3 faces', () => {
		const sk = buildBox({ ...BASE, tampa: 'deslizante' });
		const frente = pecaPorId(sk, 'frente');
		const tras = pecaPorId(sk, 'tras');
		expect(frente.bbox.h).toBeLessThan(tras.bbox.h);
		// A traseira ganha um rasgo interno; as laterais, um rasgo aberto na frente.
		const rasgoTras = tras.paths.filter((p, i) => i > 0 && p.layer === 'CORTE');
		expect(rasgoTras).toHaveLength(1);
		const tampa = pecaPorId(sk, 'tampa');
		expect(tampa.bbox.w).toBeCloseTo(206, 6);
	});
});
