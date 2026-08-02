import { describe, expect, it } from 'vitest';
import {
	type BendSpec,
	bendAllowance,
	bendDeduction,
	cornerRelief,
	developedLength,
	K_FACTOR,
	minBendRadius,
	validateBend,
} from '@/lib/cad/bend.js';

/** Dobra reta em aço carbono 2 mm com raio 2 mm — o caso de referência. */
const ACO_2MM: Omit<BendSpec, 'angulo'> = {
	raio: 2,
	espessura: 2,
	fatorK: K_FACTOR.aco_carbono,
};

describe('bend allowance e bend deduction', () => {
	it('90° em aço carbono 2 mm, r=2, K=0,38 bate com a tabela', () => {
		// BA = (π/180)·90·(2 + 0,38·2) = (π/2)·2,76
		const ba = bendAllowance(90, 2, 2, 0.38);
		expect(ba).toBeCloseTo(4.3353979, 6);

		// Setback = (r + t)·tan(45°) = 4 → BD = 8 − BA
		const bd = bendDeduction(90, 2, 2, 0.38);
		expect(bd).toBeCloseTo(3.6646021, 6);
		expect(bd).toBeCloseTo(2 * (2 + 2) * Math.tan(Math.PI / 4) - ba, 12);
	});

	it('K maior empurra a fibra neutra para fora: mais arco, menos dedução', () => {
		const baAco = bendAllowance(90, 2, 2, K_FACTOR.aco_carbono);
		const baInox = bendAllowance(90, 2, 2, K_FACTOR.inox_304);
		expect(baInox).toBeGreaterThan(baAco);
		// A soma BA + BD é o dobro do setback e não depende de K.
		const soma = (K: number) =>
			bendAllowance(90, 2, 2, K) + bendDeduction(90, 2, 2, K);
		expect(soma(K_FACTOR.inox_304)).toBeCloseTo(soma(K_FACTOR.aco_carbono), 12);
		expect(soma(K_FACTOR.aluminio)).toBeCloseTo(8, 12);
	});

	it('dobra suave (45°) consome menos que a reta', () => {
		expect(bendDeduction(45, 2, 2, 0.38)).toBeLessThan(
			bendDeduction(90, 2, 2, 0.38),
		);
		expect(bendAllowance(45, 2, 2, 0.38)).toBeCloseTo(
			bendAllowance(90, 2, 2, 0.38) / 2,
			12,
		);
	});

	it('rejeita ângulo, espessura, raio e fator K fora do domínio físico', () => {
		expect(() => bendAllowance(0, 2, 2, 0.38)).toThrow(/Ângulo de dobra/);
		expect(() => bendAllowance(180, 2, 2, 0.38)).toThrow(/Ângulo de dobra/);
		expect(() => bendAllowance(90, 2, 0, 0.38)).toThrow(/Espessura/);
		expect(() => bendAllowance(90, -1, 2, 0.38)).toThrow(/Raio interno/);
		expect(() => bendAllowance(90, 2, 2, 0.9)).toThrow(/Fator K/);
		expect(() => bendDeduction(90, 2, 2, 0)).toThrow(/Fator K/);
	});
});

describe('comprimento desenvolvido', () => {
	// Bandeja (caixa aberta) 300×200 com abas de 60, aço carbono 2 mm, r=2:
	// 4 dobras de 90°, duas cadeias cruzadas de 2 dobras cada.
	const dobra: BendSpec = { angulo: 90, ...ACO_2MM };
	const BD90 = 3.6646021382456846;

	it('planifica as duas cadeias da bandeja de 4 dobras', () => {
		const chapaX = developedLength([60, 300, 60], [dobra, dobra]);
		const chapaY = developedLength([60, 200, 60], [dobra, dobra]);
		expect(chapaX).toBeCloseTo(420 - 2 * BD90, 6);
		expect(chapaX).toBeCloseTo(412.6707957, 6);
		expect(chapaY).toBeCloseTo(320 - 2 * BD90, 6);
		expect(chapaY).toBeCloseTo(312.6707957, 6);
		// A chapa plana é MENOR que a soma das faces — é isso que a dobra devolve.
		expect(chapaX).toBeLessThan(420);
	});

	it('face única sem dobra devolve a própria face', () => {
		expect(developedLength([137.5], [])).toBeCloseTo(137.5, 12);
	});

	it('exige uma dobra a menos que o número de faces', () => {
		expect(() => developedLength([60, 300, 60], [dobra])).toThrow(
			/Cadeia de dobras inconsistente/,
		);
		expect(() => developedLength([], [])).toThrow(/pelo menos uma face/);
		expect(() => developedLength([60, 0], [dobra])).toThrow(/maior que zero/);
	});

	it('recusa planificação em que as dobras comem mais que as faces', () => {
		const gorda: BendSpec = {
			angulo: 90,
			raio: 30,
			espessura: 3,
			fatorK: K_FACTOR.aco_carbono,
		};
		expect(() => developedLength([5, 5, 5], [gorda, gorda])).toThrow(
			/consomem mais material/,
		);
	});
});

describe('alívio de canto', () => {
	it('largura t + k e profundidade r + t, com o desenhado compensando o kerf', () => {
		const rel = cornerRelief({ t: 2, k: 0.2, r: 2 });
		expect(rel.largura).toBeCloseTo(2.2, 12);
		expect(rel.profundidade).toBeCloseTo(4, 12);
		// Entalhe é vazio: desenha-se k mais estreito para SAIR com t + k.
		expect(rel.larguraDesenhada).toBeCloseTo(2, 12);
		// Fundo é fronteira única: k/2.
		expect(rel.profundidadeDesenhada).toBeCloseTo(3.9, 12);
		expect(rel.raioFundo).toBeCloseTo(1.1, 12);
		expect(rel.raioFundoDesenhado).toBeCloseTo(1, 12);
	});

	it('desenhado + kerf devolve exatamente o final (o contrato do módulo)', () => {
		const k = 0.18;
		const rel = cornerRelief({ t: 3, k, r: 1.5 });
		expect(rel.larguraDesenhada + k).toBeCloseTo(rel.largura, 12);
		expect(rel.profundidadeDesenhada + k / 2).toBeCloseTo(rel.profundidade, 12);
	});

	it('kerf zero (fresa ideal) deixa desenhado igual a final', () => {
		const rel = cornerRelief({ t: 2, k: 0, r: 2 });
		expect(rel.larguraDesenhada).toBeCloseTo(rel.largura, 12);
		expect(rel.profundidadeDesenhada).toBeCloseTo(rel.profundidade, 12);
	});

	it('rejeita espessura, kerf e raio inválidos', () => {
		expect(() => cornerRelief({ t: 0, k: 0.2, r: 2 })).toThrow(/Espessura/);
		expect(() => cornerRelief({ t: 2, k: -0.1, r: 2 })).toThrow(/Kerf/);
		expect(() => cornerRelief({ t: 2, k: 0.2, r: -1 })).toThrow(/Raio interno/);
	});
});

describe('raio mínimo por material', () => {
	it('aço carbono dobra a 0,5·t e inox 304 exige 1,0·t', () => {
		expect(minBendRadius('aco_carbono', 2)).toBeCloseTo(1, 12);
		expect(minBendRadius('inox_304', 2)).toBeCloseTo(2, 12);
		expect(minBendRadius('aluminio', 3)).toBeCloseTo(3, 12);
		expect(minBendRadius('corten', 1.5)).toBeCloseTo(1.5, 12);
	});
});

describe('invariantes da dobra', () => {
	const ok = { t: 2, r: 2, material: 'aco_carbono' as const };

	it('peça bem dimensionada não gera nada', () => {
		const v = validateBend({ ...ok, flange: 30, furoDist: 20 });
		expect(v.fatal).toEqual([]);
		expect(v.warnings).toEqual([]);
	});

	it('raio abaixo do mínimo do material é fatal', () => {
		// r = 1,2 passa em aço carbono (mín. 1,0) e reprova em inox (mín. 2,0).
		expect(
			validateBend({ t: 2, r: 1.2, material: 'aco_carbono' }).fatal,
		).toEqual([]);
		const v = validateBend({ t: 2, r: 1.2, material: 'inox_304' });
		expect(v.fatal).toHaveLength(1);
		expect(v.fatal[0]).toMatch(/trinca/);
	});

	it('aba menor que 4t + r é fatal', () => {
		// mínimo = 4·2 + 2 = 10
		expect(validateBend({ ...ok, flange: 10 }).fatal).toEqual([]);
		const v = validateBend({ ...ok, flange: 9.5 });
		expect(v.fatal).toHaveLength(1);
		expect(v.fatal[0]).toMatch(/matriz V/);
	});

	it('furo perto demais da linha de dobra é aviso, não fatal', () => {
		// mínimo = 2,5·2 + 2 = 7
		expect(validateBend({ ...ok, furoDist: 7 }).warnings).toEqual([]);
		const v = validateBend({ ...ok, furoDist: 6.9 });
		expect(v.fatal).toEqual([]);
		expect(v.warnings).toHaveLength(1);
		expect(v.warnings[0]).toMatch(/oval/);
	});

	it('acumula invariantes independentes', () => {
		const v = validateBend({
			t: 3,
			r: 1,
			material: 'inox_304',
			flange: 5,
			furoDist: 2,
		});
		expect(v.fatal).toHaveLength(2); // raio abaixo do mínimo + aba curta
		expect(v.warnings).toHaveLength(1); // furo oval
	});

	it('espessura, raio e material inválidos são fatais', () => {
		expect(
			validateBend({ t: 0, r: 2, material: 'aco_carbono' }).fatal[0],
		).toMatch(/Espessura/);
		expect(
			validateBend({ t: 2, r: -1, material: 'aco_carbono' }).fatal[0],
		).toMatch(/Raio interno/);
		const v = validateBend({
			t: 2,
			r: 2,
			material: 'latao' as unknown as 'corten',
		});
		expect(v.fatal[0]).toMatch(/Material de dobra desconhecido/);
	});
});
