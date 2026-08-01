import { describe, expect, it } from 'vitest';
import {
	AREA_POR_PESSOA_M2,
	type BbqParams,
	buildBbq,
	C_MAX,
	RAZAO_CW,
} from '@/lib/cad/generators/bbq.js';
import type { CadPath, Part, Sketch2D } from '@/lib/cad/ir.js';

/** Churrasqueira de referência: 20 pessoas em chapa de 2 mm. */
const BASE: BbqParams = {
	pessoas: 20,
	espessura: 2,
	kerf: 0.2,
	folga: 0.15,
	raio_dobra: 2,
	profundidade: 200,
};

function peca(sk: Sketch2D, id: string): Part {
	const p = sk.parts.find((x) => x.id === id);
	if (!p) throw new Error(`peça "${id}" não gerada`);
	return p;
}

function contornoDe(part: Part) {
	const path = part.paths.find(
		(p: CadPath) => p.layer === 'CORTE' && p.seg.k === 'poly',
	);
	if (!path || path.seg.k !== 'poly') throw new Error('sem contorno');
	return path.seg;
}

function porLayer(part: Part, layer: CadPath['layer']): CadPath[] {
	return part.paths.filter((p) => p.layer === layer);
}

describe('churrasqueira — dimensionamento por pessoas', () => {
	const sk = buildBbq(BASE);
	const C = sk.meta.params.comprimento as number;
	const W = sk.meta.params.largura as number;

	it('20 pessoas dão 0,6 m² de grelha na razão 2:1', () => {
		// A = 0,03 m²/pessoa × 20 = 0,6 m²; C = √(2A) em metros = 1,0954 m.
		expect(C).toBeCloseTo(1095.445115, 6);
		expect(W).toBeCloseTo(547.722558, 6);
		expect(C / W).toBeCloseTo(RAZAO_CW, 12);
		expect((C * W) / 1e6).toBeCloseTo(AREA_POR_PESSOA_M2 * 20, 9);
		expect(sk.meta.params.area_grelha_m2).toBeCloseTo(0.6, 9);
	});

	it('pessoas SOBRESCREVE as medidas informadas, e avisa', () => {
		const forcado = buildBbq({ ...BASE, comprimento: 300, largura: 300 });
		expect(forcado.meta.params.comprimento).toBeCloseTo(C, 9);
		expect(forcado.meta.params.largura).toBeCloseTo(W, 9);
		expect(forcado.meta.warnings.some((w) => /substituíd/i.test(w))).toBe(true);
	});

	it('acima do teto de comprimento a peça é limitada e avisa', () => {
		const enorme = buildBbq({ ...BASE, pessoas: 200 });
		expect(enorme.meta.params.comprimento).toBe(C_MAX);
		expect(enorme.meta.params.largura).toBe(C_MAX / RAZAO_CW);
		expect(enorme.meta.warnings.some((w) => /limitado/i.test(w))).toBe(true);
	});

	it('sem pessoas as medidas viram obrigatórias', () => {
		expect(() => buildBbq({ espessura: 2 })).toThrow(/comprimento/);
	});
});

describe('churrasqueira — modos de construção', () => {
	const dobrada = buildBbq({ ...BASE, construcao: 'dobrada' });
	const encaixada = buildBbq({ ...BASE, construcao: 'encaixada' });
	const soldada = buildBbq({ ...BASE, construcao: 'soldada' });

	it('contagem de peças coerente com cada construção', () => {
		// Dobrada: fundo e as 4 abas saem da MESMA chapa.
		expect(dobrada.parts.map((p) => p.id)).toEqual(['corpo']);
		// Soldada: 5 chapas soltas que o soldador une.
		expect(soldada.parts.map((p) => p.id)).toEqual([
			'frente',
			'tras',
			'esquerda',
			'direita',
			'fundo',
		]);
		// Encaixada: as mesmas 5 + a moldura de topo, que é quem trava as paredes
		// na falta de solda.
		expect(encaixada.parts.map((p) => p.id)).toEqual([
			'frente',
			'tras',
			'esquerda',
			'direita',
			'fundo',
			'moldura',
		]);
		expect(dobrada.parts.length).toBeLessThan(soldada.parts.length);
		expect(soldada.parts.length).toBeLessThan(encaixada.parts.length);
	});

	it('só o modo encaixado tem dente: a soldada é chapa lisa com marcação', () => {
		const frenteEnc = peca(encaixada, 'frente');
		const frenteSol = peca(soldada, 'frente');
		// Rasgos de encaixe são caminhos de CORTE extras além do contorno.
		expect(porLayer(frenteEnc, 'CORTE').length).toBeGreaterThan(1);
		expect(porLayer(frenteSol, 'CORTE').length).toBe(1);
		// O soldador recebe onde cada parede encosta.
		expect(porLayer(frenteSol, 'MARCACAO').length).toBe(2);
		expect(porLayer(peca(soldada, 'fundo'), 'MARCACAO').length).toBe(1);
		expect(porLayer(frenteEnc, 'MARCACAO').length).toBe(0);
	});

	it('cutLengthMm > 0 nos três modos', () => {
		for (const sk of [dobrada, encaixada, soldada]) {
			expect(sk.meta.stats.cutLengthMm).toBeGreaterThan(0);
			expect(sk.meta.stats.partCount).toBe(
				sk.parts.reduce((s, p) => s + p.qty, 0),
			);
		}
	});
});

describe('churrasqueira — chapa dobrada', () => {
	const t = 2;
	const k = 0.2;
	const r = 2;
	const sk = buildBbq({ ...BASE, construcao: 'dobrada' });
	const corpo = peca(sk, 'corpo');
	const plan = sk.meta.params.planificacao as {
		blank: { x: number; y: number };
		bend_allowance: number;
		setback: number;
		alivio_canto: Record<string, number>;
	};

	it('emite uma linha de DOBRA por dobra — quatro, não zero', () => {
		const dobras = porLayer(corpo, 'DOBRA');
		expect(dobras.length).toBe(4);
		for (const d of dobras) expect(d.seg.k).toBe('line');
		// Linha de dobra NUNCA na layer de corte: cortar ali parte a peça em cinco.
		expect(porLayer(corpo, 'CORTE').length).toBe(1);
	});

	it('o blank bate com a planificação (2 cadeias cruzadas de 2 dobras)', () => {
		// BA(90°, r=2, t=2, K=0,38) = 4,3353979 e setback = r + t = 4 →
		// BD = 8 − BA = 3,6646021. Lx = 2·200 + 1095,445 − 2·BD.
		expect(plan.bend_allowance).toBeCloseTo(4.3353979, 6);
		expect(plan.setback).toBe(4);
		const bd = 2 * plan.setback - plan.bend_allowance;
		const C = sk.meta.params.comprimento as number;
		const W = sk.meta.params.largura as number;
		expect(plan.blank.x).toBeCloseTo(2 * 200 + C - 2 * bd, 6);
		expect(plan.blank.y).toBeCloseTo(2 * 200 + W - 2 * bd, 6);
		expect(corpo.bbox.w).toBeCloseTo(plan.blank.x, 6);
		expect(corpo.bbox.h).toBeCloseTo(plan.blank.y, 6);
	});

	it('alívio de canto: entalhe passa da zona deformada e tem fundo redondo', () => {
		// A regra de fábrica pede r + t a partir da tangente; com este raio a bend
		// allowance é MAIOR que r + t, e o entalhe tem de terminar depois dela.
		const profDesenhada = r + t - k / 2;
		const dx = plan.alivio_canto.entalhe_x - plan.alivio_canto.tangente_x;
		const dy = plan.alivio_canto.entalhe_y - plan.alivio_canto.tangente_y;
		expect(dx).toBeGreaterThanOrEqual(profDesenhada);
		expect(dx).toBeGreaterThanOrEqual(plan.bend_allowance - 1e-9);
		expect(dy).toBeCloseTo(dx, 12);
		expect(plan.alivio_canto.largura_final).toBeCloseTo(t + k, 12);
		expect(plan.alivio_canto.profundidade_final).toBeCloseTo(r + t, 12);

		const seg = contornoDe(corpo);
		if (seg.k !== 'poly') throw new Error('contorno não é poly');
		// Blank em cruz: 12 cantos, os 4 côncavos filetados viram 2 vértices cada.
		expect(seg.pts.length).toBe(16);
		const arcos = (seg.bulges ?? []).filter((b) => Math.abs(b) > 1e-9);
		expect(arcos.length).toBe(4);
		// Canto vivo no fundo do alívio é onde a trinca começa: os quatro são arcos,
		// e horários (bulge negativo) porque o canto é côncavo.
		for (const b of arcos) expect(b).toBeCloseTo(-Math.tan(Math.PI / 8), 9);
	});

	it('raio abaixo do mínimo do material é fatal', () => {
		// Inox 304 exige r >= 1,0·t; aço carbono aceita 0,5·t.
		expect(() =>
			buildBbq({ ...BASE, material: 'inox_304', raio_dobra: 1.2 }),
		).toThrow(/Raio interno/);
		expect(() =>
			buildBbq({ ...BASE, material: 'aco_carbono', raio_dobra: 1.2 }),
		).not.toThrow();
	});
});

describe('churrasqueira — grelha', () => {
	const base: BbqParams = { ...BASE, grelha: 'chapa_vazada' };

	it('a barra remanescente abaixo do mínimo vira warning', () => {
		// b = passo − rasgo = 2 mm, contra max(3; 1,5·t) = 3 mm.
		const ruim = buildBbq({ ...base, grelha_passo: 10, grelha_rasgo: 8 });
		expect(ruim.meta.warnings.some((w) => /barra da grelha/i.test(w))).toBe(
			true,
		);
		const bom = buildBbq({ ...base, grelha_passo: 12, grelha_rasgo: 8 });
		expect(bom.meta.warnings.some((w) => /barra da grelha/i.test(w))).toBe(
			false,
		);
	});

	it('os rasgos saem com ponta redonda e já descontam o kerf', () => {
		const sk = buildBbq({ ...base, grelha_passo: 12, grelha_rasgo: 8 });
		const grelha = peca(sk, 'grelha');
		const rasgos = grelha.paths.filter(
			(p) => p.layer === 'CORTE' && p.seg.k === 'poly' && p.seg.bulges,
		);
		expect(rasgos.length).toBeGreaterThan(10);
		for (const p of rasgos) {
			if (p.seg.k !== 'poly') continue;
			// Rasgo é vazio: desenhado 8 − 0,2 para SAIR com 8 depois do corte.
			const ys = p.seg.pts.map((q) => q.y);
			expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(8 - 0.2, 9);
			expect(
				(p.seg.bulges ?? []).filter((b) => Math.abs(b - 1) < 1e-9).length,
			).toBe(2);
		}
	});

	it('níveis de apoio começam em 0,35·H e abrem rasgo nas duas paredes longas', () => {
		const sk = buildBbq({ ...base, grelha_niveis: 2 });
		const niveis = sk.meta.params.niveis_z as number[];
		expect(niveis.length).toBe(2);
		expect(niveis[0]).toBeCloseTo(0.35 * 200, 9);
		expect(niveis[1]).toBeGreaterThan(niveis[0]);
		// 2 níveis × 2 apoios por parede, nas duas paredes longas do corpo dobrado.
		const corpo = peca(sk, 'corpo');
		const rasgosApoio = corpo.paths.filter(
			(p) => p.layer === 'CORTE' && p.seg.k === 'poly' && !p.seg.bulges,
		);
		expect(rasgosApoio.length).toBe(8);
	});

	it('varões viram furos na parede e um aviso de compra', () => {
		const sk = buildBbq({ ...BASE, grelha: 'varoes_apoio', grelha_niveis: 1 });
		const corpo = peca(sk, 'corpo');
		expect(
			corpo.paths.filter((p) => p.seg.k === 'circle').length,
		).toBeGreaterThan(10);
		expect(
			sk.meta.warnings.some((w) => /varões NÃO saem do laser/i.test(w)),
		).toBe(true);
		expect(sk.parts.find((p) => p.id === 'grelha')).toBeUndefined();
	});
});

describe('churrasqueira — pés, respiros e cinzeiro', () => {
	it('pé em X fora do limite de tombamento vira warning', () => {
		const seguro = buildBbq({ ...BASE, pes: 'cruzado_x', altura_pes: 700 });
		// pegada = 0,8 × min(C, W) = 438,2 mm contra 0,6 × 700 = 420 mm.
		expect(seguro.meta.warnings.some((w) => /tomba/i.test(w))).toBe(false);
		const tombando = buildBbq({ ...BASE, pes: 'cruzado_x', altura_pes: 900 });
		expect(tombando.meta.warnings.some((w) => /tomba/i.test(w))).toBe(true);
		expect(tombando.parts.map((p) => p.id)).toContain('pe_x_a');
		expect(tombando.parts.map((p) => p.id)).toContain('pe_x_b');
	});

	it('pé em aba não existe na chapa dobrada e cai para chapa dobrada', () => {
		const sk = buildBbq({ ...BASE, construcao: 'dobrada', pes: 'abas' });
		expect(sk.meta.params.pes).toBe('chapa_dobrada');
		expect(peca(sk, 'pe').qty).toBe(2);
		expect(porLayer(peca(sk, 'pe'), 'DOBRA').length).toBe(2);
		expect(sk.meta.warnings.some((w) => /aba não existe/i.test(w))).toBe(true);
	});

	it('respiro nunca encosta na dobra do fundo', () => {
		const sk = buildBbq({ ...BASE, respiros: 'furos', respiro_area_pct: 5 });
		const distDobra = sk.meta.params.dist_min_dobra as number;
		expect(distDobra).toBeCloseTo(2.5 * 2 + 2, 9);
		const corpo = peca(sk, 'corpo');
		const furos = corpo.paths.filter((p) => p.seg.k === 'circle');
		expect(furos.length).toBeGreaterThan(0);
		const plan = sk.meta.params.planificacao as {
			blank: { x: number };
			alivio_canto: { tangente_x: number };
		};
		const x1 = plan.alivio_canto.tangente_x;
		const x4 = plan.blank.x - x1;
		for (const f of furos) {
			if (f.seg.k !== 'circle') continue;
			// Os respiros ficam nas duas abas laterais; a altura de cada um é medida
			// da tangente da SUA dobra (x1 à esquerda, x4 à direita).
			const z = f.seg.c.x < plan.blank.x / 2 ? x1 - f.seg.c.x : f.seg.c.x - x4;
			expect(z - f.seg.r).toBeGreaterThanOrEqual(distDobra);
		}
	});

	it('cinzeiro gaveta sai como bandeja dobrada com puxador obround', () => {
		const sk = buildBbq({ ...BASE, cinzeiro: 'gaveta' });
		const gaveta = peca(sk, 'cinzeiro');
		expect(porLayer(gaveta, 'DOBRA').length).toBe(4);
		const puxador = gaveta.paths.find(
			(p) =>
				p.seg.k === 'poly' &&
				p.seg.bulges?.some((b) => Math.abs(b - 1) < 1e-9) === true,
		);
		expect(puxador).toBeDefined();
		if (puxador && puxador.seg.k === 'poly') {
			const xs = puxador.seg.pts.map((q) => q.x);
			const ys = puxador.seg.pts.map((q) => q.y);
			// 60 × 12 nominais, desenhados 0,2 menores porque o rasgo é vazio.
			expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(
				60 - 0.2 - (12 - 0.2),
				9,
			);
			expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(12 - 0.2, 9);
		}
		// Sem fundo perfurado a cinza não chega na gaveta.
		expect(sk.meta.warnings.some((w) => /gaveta de cinzas/i.test(w))).toBe(
			true,
		);
		expect(peca(sk, 'corpo').paths.some((p) => p.seg.k === 'circle')).toBe(
			true,
		);
	});

	it('chapa mais grossa do que a fibra corta vira warning', () => {
		const sk = buildBbq({
			...BASE,
			material: 'inox_304',
			espessura: 12,
			raio_dobra: 12,
		});
		expect(sk.meta.warnings.some((w) => /fibra de bancada/i.test(w))).toBe(
			true,
		);
	});
});
