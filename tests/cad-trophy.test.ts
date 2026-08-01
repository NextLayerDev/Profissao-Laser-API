import { describe, expect, it } from 'vitest';
import { sketchToAssembly } from '@/lib/cad/assembly.js';
import {
	buildTrophy,
	FURO_PARAFUSO_D,
	LARG_BASE_FRACAO,
	LARG_TOPO_FRACAO,
	PEGADA_MIN_FRACAO,
	type TrophyParams,
	type TrophySilhueta,
} from '@/lib/cad/generators/trophy.js';
import type { CadPath, Part, Pt, Sketch2D } from '@/lib/cad/ir.js';

/** Troféu de referência: 260 mm em MDF de 3 mm, base 130 × 130 × 6. */
const BASE: TrophyParams = {
	altura_total: 260,
	espessura: 3,
	material: 'mdf',
	kerf: 0.15,
	folga: 0.1,
	base_largura: 130,
	base_profundidade: 130,
	base_espessura: 6,
	silhueta: 'conica',
	placa: 'retangular',
	placa_altura: 40,
	gravacao_placa: 'CAMPEAO 2026',
	gravacao_altura: 6,
	fixacao: 'encaixe',
};

const K = BASE.kerf as number;
const C = BASE.folga as number;
const T = BASE.espessura;

function peca(sk: Sketch2D, id: string): Part {
	const p = sk.parts.find((x) => x.id === id);
	if (!p) throw new Error(`peça "${id}" não gerada`);
	return p;
}

function contornoDe(part: Part): { pts: Pt[]; bulges?: number[] } {
	const path = part.paths.find(
		(p: CadPath) => p.layer === 'CORTE' && p.seg.k === 'poly',
	);
	if (!path || path.seg.k !== 'poly') throw new Error('sem contorno');
	return path.seg;
}

/** Caixa de um caminho retangular (polilinha de 4 pontos sem bulge). */
function retangulos(part: Part): Array<{ w: number; h: number }> {
	const out: Array<{ w: number; h: number }> = [];
	for (const p of part.paths) {
		if (p.layer !== 'CORTE' || p.seg.k !== 'poly') continue;
		if (p.seg.pts.length !== 4 || p.seg.bulges) continue;
		const xs = p.seg.pts.map((q) => q.x);
		const ys = p.seg.pts.map((q) => q.y);
		out.push({
			w: Math.max(...xs) - Math.min(...xs),
			h: Math.max(...ys) - Math.min(...ys),
		});
	}
	return out;
}

/**
 * Ys dos quatro pontos da fenda do cross lap: são os únicos do contorno da haste
 * a meia largura de fenda do eixo (as espigas, o perfil e os cantos ficam longe).
 */
function ysDaFenda(part: Part, xc: number, slotLarg: number): number[] {
	const { pts } = contornoDe(part);
	return pts
		.filter((p) => Math.abs(Math.abs(p.x - xc) - slotLarg / 2) < 1e-9)
		.map((p) => p.y);
}

function meta(sk: Sketch2D): Record<string, number> {
	return sk.meta.params as unknown as Record<string, number>;
}

// ---------------------------------------------------------------------------

describe('troféu — cruzamento das duas hastes (cross lap)', () => {
	const sk = buildTrophy(BASE);
	const p = meta(sk);
	const cruz = sk.meta.params.cruzamento as Record<string, number>;
	const Hh = p.altura_haste;
	const xc = p.largura_haste_pe / 2;

	it('a altura útil da haste é altura_total − base − placa', () => {
		expect(Hh).toBeCloseTo(260 - 6 - 40, 12);
		expect(p.largura_haste_pe).toBeCloseTo(LARG_BASE_FRACAO * Hh, 12);
		expect(p.largura_haste_topo).toBeCloseTo(LARG_TOPO_FRACAO * Hh, 12);
	});

	it('as DUAS fendas somadas dão exatamente a altura da haste', () => {
		// Fenda de cima: do topo do corpo para baixo. Fenda de baixo: do ombro da
		// base para cima. Se a soma passar de Hh as duas chapas disputam o mesmo
		// espaço; se faltar, sobra vão e o cruzamento escorrega na vertical.
		const hEspiga = (sk.meta.params.espiga_pe as Record<string, number>)
			.altura_desenhada;
		const ysA = ysDaFenda(
			peca(sk, 'haste_topo'),
			xc,
			cruz.fenda_larg_desenhada,
		);
		const ysB = ysDaFenda(
			peca(sk, 'haste_base'),
			xc,
			cruz.fenda_larg_desenhada,
		);
		expect(ysA).toHaveLength(4);
		expect(ysB).toHaveLength(4);

		// A haste de cima é desenhada sem sobra na fixação por encaixe: o topo da
		// fenda é o topo do corpo.
		const topoA = Math.max(...ysA);
		expect(topoA).toBeCloseTo(hEspiga + Hh, 9);
		const profDesenhadaA = topoA - Math.min(...ysA);
		const profDesenhadaB = Math.max(...ysB) - hEspiga;
		expect(Math.min(...ysB)).toBeCloseTo(hEspiga, 9);

		// Fundo de fenda é fronteira ÚNICA do lado do vazio: cada fenda é desenhada
		// k/2 mais rasa e o feixe entrega a profundidade nominal.
		expect(profDesenhadaA).toBeCloseTo(cruz.fenda_prof_desenhada, 9);
		expect(profDesenhadaB).toBeCloseTo(cruz.fenda_prof_desenhada, 9);
		const finalA = profDesenhadaA + K / 2;
		const finalB = profDesenhadaB + K / 2;
		expect(finalA).toBeCloseTo(Hh / 2, 9);
		expect(finalB).toBeCloseTo(Hh / 2, 9);
		expect(finalA + finalB).toBeCloseTo(Hh, 9);
	});

	it('a folga FINAL da fenda sobre a espessura da outra chapa é c exata', () => {
		const ysA = ysDaFenda(
			peca(sk, 'haste_topo'),
			xc,
			cruz.fenda_larg_desenhada,
		);
		expect(ysA).toHaveLength(4);
		// Largura desenhada medida no próprio contorno, não no meta.
		const { pts } = contornoDe(peca(sk, 'haste_topo'));
		const xsFenda = [
			...new Set(
				pts
					.filter(
						(q) =>
							Math.abs(Math.abs(q.x - xc) - cruz.fenda_larg_desenhada / 2) <
							1e-9,
					)
					.map((q) => q.x),
			),
		];
		expect(xsFenda).toHaveLength(2);
		const largDesenhada = Math.abs(xsFenda[0] - xsFenda[1]);
		// A fenda é VAZIO nas duas laterais: o feixe alarga em k.
		expect(largDesenhada + K - T).toBeCloseTo(C, 12);
		expect(cruz.fenda_larg_final - T).toBeCloseTo(C, 12);
	});

	it('as duas hastes existem e são peças distintas (senão o troféu tomba)', () => {
		const a = peca(sk, 'haste_topo');
		const b = peca(sk, 'haste_base');
		expect(a.qty).toBe(1);
		expect(b.qty).toBe(1);
		// Mesma silhueta, fendas em metades opostas: a de cima é mais alta porque
		// leva as espigas da placa.
		expect(a.bbox.w).toBeCloseTo(b.bbox.w, 12);
		expect(a.bbox.h).toBeGreaterThan(b.bbox.h);
		// Cruzadas a 90°: a rotação em Z difere de π/2.
		expect((a.pose?.rot[2] ?? 0) - (b.pose?.rot[2] ?? 0)).toBeCloseTo(
			-Math.PI / 2,
			12,
		);
	});
});

describe('troféu — espiga do pé e fenda da base', () => {
	const sk = buildTrophy(BASE);
	const esp = sk.meta.params.espiga_pe as Record<string, number>;

	it('a espiga é passante e sai rente à face de baixo da base', () => {
		const { pts } = contornoDe(peca(sk, 'haste_topo'));
		const naBase = pts.filter((p) => Math.abs(p.y) < 1e-12);
		expect(naBase).toHaveLength(4); // duas espigas, dois pontos cada
		const xs = naBase.map((p) => p.x).sort((a, b) => a - b);
		const larg1 = xs[1] - xs[0];
		const larg2 = xs[3] - xs[2];
		expect(larg1).toBeCloseTo(larg2, 9);
		expect(larg1).toBeCloseTo(esp.largura_desenhada, 9);
		// Altura desenhada com `outer`: sai exatamente a espessura da base.
		expect(esp.altura_desenhada - K).toBeCloseTo(
			BASE.base_espessura as number,
			12,
		);
	});

	it('espiga e fenda da base montam com folga c nos dois eixos', () => {
		const rets = retangulos(peca(sk, 'base'));
		expect(rets).toHaveLength(4); // 2 fendas por haste
		const largas = rets.filter((r) => r.w > r.h);
		const altas = rets.filter((r) => r.h > r.w);
		expect(largas).toHaveLength(2);
		expect(altas).toHaveLength(2);

		// Fenda é VAZIO (ganha k), espiga é MATERIAL (perde k).
		const fendaFinal = largas[0].w + K;
		const espigaFinal = esp.largura_desenhada - K;
		expect(fendaFinal - espigaFinal).toBeCloseTo(C, 12);
		// No eixo da espessura a folga também é c.
		expect(largas[0].h + K - T).toBeCloseTo(C, 12);
		// A fenda da outra haste é a mesma, girada 90°.
		expect(altas[0].h).toBeCloseTo(largas[0].w, 12);
		expect(altas[0].w).toBeCloseTo(largas[0].h, 12);
	});
});

describe('troféu — invariante de estabilidade', () => {
	it('base menor que 0,45 × altura gera aviso dizendo quanto aumentar', () => {
		const sk = buildTrophy({
			...BASE,
			base_largura: 80,
			base_profundidade: 90,
		});
		const alvo = PEGADA_MIN_FRACAO * (BASE.altura_total as number);
		const aviso = sk.meta.warnings.find((w) => /tombar/i.test(w));
		expect(aviso).toBeDefined();
		expect(aviso).toMatch(/117 mm/); // 0,45 × 260
		expect(aviso).toMatch(/faltam 37 mm/); // 117 − 80
		expect(alvo).toBeCloseTo(117, 12);
	});

	it('o troféu de referência não gera aviso nenhum', () => {
		expect(buildTrophy(BASE).meta.warnings).toEqual([]);
	});

	it('altura que não sobra haste é erro 400 acionável', () => {
		expect(() =>
			buildTrophy({
				...BASE,
				altura_total: 40,
				base_espessura: 30,
				placa_altura: 20,
			}),
		).toThrow(/não sobra nada para a haste/i);
	});
});

describe('troféu — as quatro silhuetas', () => {
	const silhuetas: TrophySilhueta[] = ['conica', 'reta', 'taca', 'estrela'];
	const gerados = silhuetas.map((silhueta) =>
		buildTrophy({ ...BASE, silhueta }),
	);

	it('todas produzem bbox coerente e do mesmo tamanho', () => {
		const Hh = meta(gerados[0]).altura_haste;
		const wPe = LARG_BASE_FRACAO * Hh;
		for (const sk of gerados) {
			const a = peca(sk, 'haste_topo');
			const b = peca(sk, 'haste_base');
			// A largura da caixa é a do pé nas quatro: nenhuma silhueta passa dela,
			// e assim o nesting não muda de comportamento quando o aluno troca.
			expect(a.bbox.w).toBeCloseTo(wPe, 9);
			expect(b.bbox.w).toBeCloseTo(wPe, 9);
			expect(a.bbox.h).toBeCloseTo(peca(gerados[0], 'haste_topo').bbox.h, 9);
			expect(b.bbox.h).toBeCloseTo(peca(gerados[0], 'haste_base').bbox.h, 9);
			expect(b.bbox.h).toBeGreaterThan(Hh);
			expect(b.bbox.h).toBeLessThan(Hh + 3 * (BASE.base_espessura as number));
		}
	});

	it('cada silhueta desenha um perfil diferente, sem repetir contorno', () => {
		const assinaturas = gerados.map((sk) =>
			JSON.stringify(contornoDe(peca(sk, 'haste_base')).pts),
		);
		expect(new Set(assinaturas).size).toBe(4);
	});

	it('todas cortam algo e nenhuma gera aviso de perna fina', () => {
		for (const sk of gerados) {
			expect(sk.meta.stats.cutLengthMm).toBeGreaterThan(0);
			expect(sk.meta.stats.partCount).toBe(4);
			expect(sk.meta.stats.pierces).toBeGreaterThan(0);
			expect(sk.meta.warnings.filter((w) => /perna/i.test(w))).toEqual([]);
		}
	});
});

describe('troféu — placa e gravação', () => {
	it('placa retangular encaixada tem entalhes e a espiga casa com folga c', () => {
		const sk = buildTrophy(BASE);
		const espPlaca = sk.meta.params.espiga_placa as Record<string, number>;
		const { pts } = contornoDe(peca(sk, 'placa'));
		// Aresta inferior: os 2 pontos de tangência dos cantos R3 mais 4 pontos dos
		// dois entalhes abertos.
		const xs = pts
			.filter((p) => Math.abs(p.y) < 1e-12)
			.map((p) => p.x)
			.sort((a, b) => a - b);
		expect(xs).toHaveLength(6);
		const entalhe1 = xs[2] - xs[1];
		const entalhe2 = xs[4] - xs[3];
		expect(entalhe1).toBeCloseTo(entalhe2, 9);
		expect(entalhe1 + K - (espPlaca.largura_desenhada - K)).toBeCloseTo(C, 9);
		// Os entalhes são simétricos em relação ao eixo da placa.
		const eixo = meta(sk).largura_placa / 2;
		expect((xs[1] + xs[4]) / 2).toBeCloseTo(eixo, 9);
	});

	it('a gravação vai na layer GRAVACAO, centrada e sem transbordar a placa', () => {
		const sk = buildTrophy(BASE);
		const placa = peca(sk, 'placa');
		const grav = placa.paths.filter((p) => p.layer === 'GRAVACAO');
		expect(grav).toHaveLength(1);
		const seg = grav[0].seg;
		if (seg.k !== 'text') throw new Error('gravação não é texto');
		expect(seg.text).toBe('CAMPEAO 2026');
		expect(seg.anchor).toBe('c');
		expect(seg.h).toBeCloseTo(6, 9);
		expect(seg.at.x).toBeCloseTo(meta(sk).largura_placa / 2, 9);
		// Texto não conta como corte, mas conta como gravação.
		expect(sk.meta.stats.engraveLengthMm).toBe(0);
	});

	it('gravação grande demais é reduzida com aviso acionável', () => {
		const sk = buildTrophy({
			...BASE,
			gravacao_placa: 'CAMPEONATO REGIONAL DE ARCO E FLECHA 2026',
			gravacao_altura: 14,
		});
		const placa = peca(sk, 'placa');
		const seg = placa.paths.find((p) => p.layer === 'GRAVACAO')?.seg;
		if (!seg || seg.k !== 'text') throw new Error('sem gravação');
		expect(seg.h).toBeLessThan(14);
		expect(sk.meta.warnings.some((w) => /não cabe/i.test(w))).toBe(true);
	});

	it('sem placa não há peça de placa e a haste fica com a altura toda', () => {
		const sk = buildTrophy({ ...BASE, placa: 'nenhuma' });
		expect(sk.parts.map((p) => p.id)).toEqual([
			'base',
			'haste_topo',
			'haste_base',
		]);
		expect(meta(sk).altura_haste).toBeCloseTo(260 - 6, 12);
		expect(sk.meta.warnings.some((w) => /gravação foi ignorada/i.test(w))).toBe(
			true,
		);
	});

	it('escudo fecha o contorno com arcos e sobe o texto do centro', () => {
		const sk = buildTrophy({ ...BASE, placa: 'escudo' });
		const placa = peca(sk, 'placa');
		const { bulges } = contornoDe(placa);
		expect(bulges?.some((b) => b !== 0)).toBe(true);
		expect(placa.bbox.w).toBeCloseTo(meta(sk).largura_placa, 9);
		expect(placa.bbox.h).toBeCloseTo(BASE.placa_altura as number, 9);
		const seg = placa.paths.find((p) => p.layer === 'GRAVACAO')?.seg;
		if (!seg || seg.k !== 'text') throw new Error('sem gravação');
		expect(seg.at.y).toBeGreaterThan((BASE.placa_altura as number) / 2);
	});

	it('fixação por parafuso troca entalhe por 2 furos compensados', () => {
		const sk = buildTrophy({ ...BASE, fixacao: 'parafuso' });
		const furos = (id: string) =>
			peca(sk, id).paths.filter((p) => p.seg.k === 'circle');
		expect(furos('placa')).toHaveLength(2);
		expect(furos('haste_topo')).toHaveLength(2);
		for (const f of [...furos('placa'), ...furos('haste_topo')]) {
			if (f.seg.k !== 'circle') throw new Error('não é círculo');
			// Furo é vazio: desenhado d − k para sair d.
			expect(2 * f.seg.r + K).toBeCloseTo(FURO_PARAFUSO_D, 12);
		}
		// A placa sem entalhe é um retângulo de cantos R3 (8 vértices, 4 arcos).
		const { pts, bulges } = contornoDe(peca(sk, 'placa'));
		expect(pts).toHaveLength(8);
		expect(bulges?.filter((b) => b !== 0)).toHaveLength(4);
	});
});

describe('troféu — montagem 3D', () => {
	for (const fixacao of ['encaixe', 'parafuso'] as const) {
		it(`empilha base + haste + placa em ${BASE.altura_total} mm (${fixacao})`, () => {
			const sk = buildTrophy({ ...BASE, fixacao });
			const asm = sketchToAssembly(sk);
			// Toda peça virou sólido: nenhuma perdeu o contorno fechado de corte.
			expect(asm.parts).toHaveLength(sk.parts.length);
			expect(asm.bbox.min[2]).toBeCloseTo(0, 6);
			expect(asm.bbox.max[2]).toBeCloseTo(BASE.altura_total, 6);
			expect(asm.bbox.min[0]).toBeCloseTo(0, 6);
			expect(asm.bbox.min[1]).toBeCloseTo(0, 6);
			expect(asm.bbox.max[0]).toBeCloseTo(BASE.base_largura as number, 6);
			expect(asm.bbox.max[1]).toBeCloseTo(BASE.base_profundidade as number, 6);
			// A base tem as 4 fendas como furos.
			const base = asm.parts.find((p) => p.id === 'base');
			expect(base?.holes).toHaveLength(4);
		});
	}
});

describe('troféu — validação de entrada', () => {
	it('opção desconhecida devolve 400 com a lista do que vale', () => {
		expect(() =>
			buildTrophy({ ...BASE, silhueta: 'piramide' as TrophySilhueta }),
		).toThrow(/conica, reta, taca, estrela/);
	});

	it('kerf maior que a chapa é fatal', () => {
		expect(() => buildTrophy({ ...BASE, espessura: 0.1, kerf: 0.2 })).toThrow(
			/kerf/i,
		);
	});

	it('acrílico com folga apertada avisa sobre trinca', () => {
		const sk = buildTrophy({ ...BASE, material: 'acrilico', folga: 0.05 });
		expect(sk.meta.warnings.some((w) => /trinca/i.test(w))).toBe(true);
		expect(sk.parts[0].material).toBe('Acrílico');
	});
});
