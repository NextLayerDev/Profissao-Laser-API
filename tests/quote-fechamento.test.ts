import { describe, expect, it } from 'vitest';
import { buildBox } from '@/lib/cad/generators/box.js';
import { analyzeGeometry, diagnose } from '@/lib/cad/topology.js';
import {
	computeQuote,
	DEFAULT_PROFILE,
	type QuoteMetrics,
	type QuoteProfile,
} from '@/lib/quote/pricing.js';
import { cabeNaChapa, lucroDoPedido } from '@/tool-blocks/blocks/quote.js';

/**
 * O FECHAMENTO DA FASE — os defeitos que a revisão adversarial provou, cada um
 * com o teste que falhava antes do conserto.
 *
 * Os três são de DINHEIRO NA MÃO DO ALUNO, e nenhum deles é aritmética errada:
 * a conta sempre esteve certa (planilha independente bateu no centavo, 368 mil
 * combinações sem prejuízo silencioso). O que estava errado era a ENTREGA —
 * dois números certos em bases diferentes na mesma tela, e um erro grave que o
 * motor calculava e ninguém via.
 */

const PECA: QuoteMetrics = {
	cutLengthMm: 2400,
	pierces: 6,
	netAreaMm2: 45_000,
	bboxAreaMm2: 60_000,
	bbox: { w: 300, h: 200 },
};
const MAT = {
	nome: 'Inox 304',
	familia: 'inox 304',
	espessuraMm: 1.2,
	densidade: 7.93,
	precoKg: 38,
	chapaWmm: 2000,
	chapaHmm: 1000,
};
const VEL = {
	speedMmS: 25,
	passes: 1,
	pierceS: 0.5,
	source: 'curated' as const,
	confidence: 1,
	estimativa: false,
	detalhe: 'linha curada de teste',
	avisos: [],
};

function perfil(over: Partial<QuoteProfile> = {}): QuoteProfile {
	return { ...DEFAULT_PROFILE, pedidoMinimo: 0, descontos: [], ...over };
}

/* ───────────── 1. O piso e a manchete falam a mesma língua ───────────── */

describe('o piso da tela está na mesma base do preço da tela', () => {
	/**
	 * A contradição medida: com 40% de desconto a tela dizia, ao mesmo tempo,
	 * "cobre R$ 7,80 por peça", "sobram R$ 144,20" e "abaixo de R$ 10,45 dá
	 * prejuízo". Os dois números estavam certos — em bases diferentes.
	 */
	it('com desconto na mesa, o preço EFETIVO fica acima do piso EFETIVO', () => {
		for (const desconto of [0, 0.1, 0.2, 0.3, 0.4, 0.5]) {
			const b = computeQuote(PECA, perfil(), {
				qty: 100,
				material: MAT,
				speed: VEL,
				descontoPct: desconto,
			});
			const l = lucroDoPedido(b);
			// A regra que a tela precisa poder afirmar sem se contradizer: enquanto
			// sobra dinheiro, o preço que ela estampa está acima do piso que ela cita.
			if (l.doPedidoCents > 0) {
				expect(b.precos.precoUnitEfetivoCents).toBeGreaterThan(
					l.pisoUnitEfetivoCents,
				);
			}
		}
	});

	it('o piso efetivo é o empate exato: um centavo abaixo dele o pedido perde', () => {
		const b = computeQuote(PECA, perfil(), {
			qty: 50,
			material: MAT,
			speed: VEL,
			descontoPct: 0.25,
		});
		const piso = b.precos.precoUnitMinimoEfetivoCents;
		const semImposto = 1 - b.precos.impostoPct;
		// No piso, o líquido paga o custo (é `ceil`, então empata ou sobra um
		// arredondamento).
		expect(piso * semImposto).toBeGreaterThanOrEqual(b.custos.totalCents);
		// Um centavo abaixo, não paga mais.
		expect((piso - 1) * semImposto).toBeLessThan(b.custos.totalCents);
	});

	it('o piso de TABELA continua existindo e é o efetivo esticado pelo desconto', () => {
		const b = computeQuote(PECA, perfil(), {
			qty: 100,
			material: MAT,
			speed: VEL,
			descontoPct: 0.3,
		});
		const tabela = b.precos.precoUnitMinimoCents;
		const efetivo = b.precos.precoUnitMinimoEfetivoCents;
		// São a MESMA verdade em duas escalas: tabela × (1 − desconto) = efetivo,
		// a menos do centavo que cada `ceil` arredonda por conta própria.
		expect(tabela).toBeGreaterThan(efetivo);
		expect(
			Math.abs(tabela * (1 - b.precos.descontoPct) - efetivo),
		).toBeLessThanOrEqual(1);
	});

	it('sem desconto as duas bases coincidem — não há dois pisos', () => {
		const b = computeQuote(PECA, perfil(), {
			qty: 10,
			material: MAT,
			speed: VEL,
		});
		expect(b.precos.descontoPct).toBe(0);
		expect(b.precos.precoUnitMinimoEfetivoCents).toBe(
			b.precos.precoUnitMinimoCents,
		);
	});
});

/* ─────────── 2. A peça que não cabe na chapa deixa de ser silêncio ─────────── */

describe('a peça cabe na chapa que ele compra?', () => {
	it('peça maior que a chapa é ERRO, com as duas medidas na frase', () => {
		const a = cabeNaChapa({ w: 2500, h: 900 }, MAT);
		expect(a).toHaveLength(1);
		expect(a[0]?.codigo).toBe('peca_maior_que_chapa');
		expect(a[0]?.severidade).toBe('erro');
		expect(a[0]?.mensagem).toContain('2.500 × 900 mm');
		expect(a[0]?.mensagem).toContain('2.000 × 1.000 mm');
		// E cita a causa mais provável, que é a que custa 439× (ver abaixo).
		expect(a[0]?.mensagem).toContain('UNIDADE');
	});

	it('a chapa não tem lado certo: a peça deitada cabe', () => {
		// 1500 × 1900 não cabe em 2000 × 1000 na orientação lida, mas cabe girada.
		expect(cabeNaChapa({ w: 900, h: 1900 }, MAT)).toEqual([]);
		expect(cabeNaChapa({ w: 1900, h: 900 }, MAT)).toEqual([]);
	});

	it('UNIDADE ERRADA (o arquivo lido em polegada) agora bate no teto', () => {
		// O caso medido: o mesmo DXF lido como polegada vira 33.274 × 3.810 mm e o
		// preço vai de R$ 128,25 para R$ 56.278,00 — antes, sem UM aviso.
		const a = cabeNaChapa({ w: 33_274, h: 3810 }, MAT);
		expect(a[0]?.severidade).toBe('erro');
	});

	it('material sem chapa cadastrada ainda tem teto de sanidade em metros', () => {
		const semChapa = { nome: 'Couro', espessuraMm: 2, precoKg: 180 };
		expect(cabeNaChapa({ w: 800, h: 600 }, semChapa)).toEqual([]);
		const gigante = cabeNaChapa({ w: 33_274, h: 3810 }, semChapa);
		expect(gigante[0]?.codigo).toBe('peca_gigante');
		expect(gigante[0]?.mensagem).toContain('33,27 × 3,81 METROS');
	});

	it('peça normal não inventa aviso nenhum', () => {
		expect(cabeNaChapa({ w: 300, h: 200 }, MAT)).toEqual([]);
		expect(cabeNaChapa(undefined, MAT)).toEqual([]);
	});
});

/* ─────────── 3. O documento do cliente não fala com o operador ─────────── */

describe('o aviso que vai para o cliente final', () => {
	it('furo pequeno tem texto próprio, sem "avise o cliente"', () => {
		const caixa = buildBox({
			dim_mode: 'externo',
			largura: 200,
			profundidade: 150,
			altura: 80,
			espessura: 3,
			material: 'MDF',
			kerf: 0.15,
			folga: 0.1,
			tampa: 'encaixe',
			fundo: true,
			div_x: 1,
		});
		const m = analyzeGeometry(caixa);
		const furo = diagnose(caixa, m, { espessura: 3, chapa: null }).find(
			(d) => d.code === 'furo_pequeno',
		);
		expect(furo).toBeDefined();
		// A do operador continua dizendo o que ele faz no CAD.
		expect(furo?.message).toContain('avise o cliente');
		// A do cliente não manda ninguém avisar ninguém, e não usa jargão de feixe.
		expect(furo?.publicMessage).toBeDefined();
		expect(furo?.publicMessage).not.toContain('avise o cliente');
		expect(furo?.publicMessage).not.toContain('feixe');
		expect(furo?.publicMessage).toContain('furo');
	});
});
