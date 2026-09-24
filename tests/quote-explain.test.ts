import { describe, expect, it } from 'vitest';
import type { CutSpeedResult } from '@/lib/quote/cut-speed.js';
import {
	dossieParaModelo,
	exigeTextoFormatado,
	explicaOrcamento,
} from '@/lib/quote/explain.js';
import {
	brl,
	duracaoBR,
	numeroBR,
	pctBR,
	pontosBR,
} from '@/lib/quote/format.js';
import type { MaterialInput } from '@/lib/quote/materials.js';
import {
	computeQuote,
	DEFAULT_PROFILE,
	type QuoteBreakdown,
	type QuoteMetrics,
	type QuoteProfile,
} from '@/lib/quote/pricing.js';

/* ─────────────────────────── Fixtures ─────────────────────────── */

/** Peça de 300×200 com quatro furos — o tamanho de uma placa de MDF real. */
const PECA: QuoteMetrics = {
	cutLengthMm: 1000 + Math.PI * 4 * 8,
	pierces: 5,
	netAreaMm2: 300 * 200 - 4 * Math.PI * 16,
	bboxAreaMm2: 60_000,
	bbox: { w: 300, h: 200 },
};

const MDF: MaterialInput = {
	nome: 'MDF',
	familia: 'mdf',
	espessuraMm: 3,
	precoKg: 8,
	chapaWmm: 2750,
	chapaHmm: 1830,
};

const VELOCIDADE_MEDIDA: CutSpeedResult = {
	speedMmS: 18,
	passes: 1,
	pierceS: 0.5,
	source: 'curated',
	confidence: 1,
	estimativa: false,
	avisos: [],
	detalhe: 'linha curada da oficina',
};

function perfil(over: Partial<QuoteProfile> = {}): QuoteProfile {
	return {
		...DEFAULT_PROFILE,
		laser: 'co2',
		potenciaW: 100,
		pedidoMinimo: 0,
		descontos: [],
		regraArredondamento: 'nenhum',
		...over,
	};
}

function orca(over: Partial<QuoteProfile> = {}, qty = 10, opts = {}) {
	return computeQuote(PECA, perfil(over), {
		qty,
		material: MDF,
		speed: VELOCIDADE_MEDIDA,
		...opts,
	});
}

/** Todo valor do dossiê, achatado, com o caminho — para as varreduras. */
function folhas(obj: object): [string, unknown][] {
	return Object.entries(obj).flatMap(([k, v]) =>
		Array.isArray(v)
			? v.map((item, i) => [`${k}[${i}]`, item] as [string, unknown])
			: [[k, v] as [string, unknown]],
	);
}

/* ─────────────────────────── Formatação ─────────────────────────── */

describe('formatação PT-BR', () => {
	it('dinheiro sai como o brasileiro lê, e o prejuízo com o sinal na frente', () => {
		expect(brl(128_25)).toBe('R$ 128,25');
		expect(brl(1_147_50)).toBe('R$ 1.147,50');
		expect(brl(0)).toBe('R$ 0,00');
		expect(brl(-14_476)).toBe('-R$ 144,76');
	});

	it('percentual, pontos e duração falam português', () => {
		expect(pctBR(0.478, 1)).toBe('47,8%');
		expect(pctBR(0.35)).toBe('35%');
		expect(pontosBR(0.09)).toBe('9 pontos');
		expect(pontosBR(0.01)).toBe('1 ponto');
		expect(duracaoBR(45)).toBe('45 s');
		expect(duracaoBR(409.64)).toBe('6,8 min');
		expect(duracaoBR(7200)).toBe('2 h');
		expect(duracaoBR(9000)).toBe('2 h 30 min');
	});

	it('não depende do ICU do runtime (nada de Intl no caminho do dinheiro)', () => {
		// Se um dia alguém trocar isto por Intl, uma imagem com ICU reduzido
		// formataria "R$ 1,234.56" e o aluno mandaria isso para o cliente dele.
		expect(numeroBR(1234.5)).toBe('1.234,50');
		expect(numeroBR(1_000_000, 0)).toBe('1.000.000');
	});
});

/* ─────────────────────────── A explicação ─────────────────────────── */

describe('explicaOrcamento', () => {
	it('cada parcela do custo tem quanto, quanto pesa e por quê — em português', () => {
		const e = explicaOrcamento(orca());
		const material = e.custo.parcelas.find((p) => p.id === 'material');
		expect(material?.titulo).toContain('MDF');
		expect(material?.valor).toMatch(/^R\$ /);
		expect(material?.participacao).toMatch(/% do custo da peça$/);
		// A conta da linha virou frase: nada de "0.0600 m² (bbox) × 3 mm × 0.75".
		expect(material?.porque).toMatch(/você cobra/);
		expect(material?.porque).toMatch(/o quilo/);

		// O overhead deixou de ser "overhead".
		const overhead = e.custo.parcelas.find((p) => p.id === 'overhead');
		expect(overhead?.titulo).toMatch(/aluguel/i);

		// Toda parcela explica de onde veio.
		for (const p of e.custo.parcelas) {
			expect(p.porque.length, p.id).toBeGreaterThan(10);
		}
	});

	it('o veredito diz, em uma frase, se o trabalho vale a pena', () => {
		const bom = explicaOrcamento(orca());
		expect(bom.veredito).toMatch(/sobram R\$/);

		const ruim = explicaOrcamento(
			orca({ markupPct: 0.35 }, 100, {
				descontoPct: 0.4,
			}),
		);
		expect(ruim.veredito).toMatch(/tira R\$/);
		expect(ruim.veredito).toMatch(/bolso/);
	});

	it('o passo a passo do preço vai do custo ao total, sem buraco', () => {
		const e = explicaOrcamento(orca({ impostoPct: 0.06 }, 10));
		const rotulos = e.preco.passos.map((p) => p.rotulo).join(' | ');
		expect(rotulos).toMatch(/Custo da peça/);
		expect(rotulos).toMatch(/Imposto/);
		expect(rotulos).toMatch(/TOTAL do pedido/);
		expect(e.preco.passos.at(-1)?.valor).toBe(
			brl(orca({ impostoPct: 0.06 }, 10).precos.precoTotalCents),
		);
	});

	it('responde as perguntas que o dono da loja faz, com número', () => {
		const b = orca();
		const e = explicaOrcamento(b);
		const perguntas = e.perguntas.map((q) => q.pergunta).join(' | ');
		expect(perguntas).toMatch(/Quanto eu cobro/);
		expect(perguntas).toMatch(/ganhando ou perdendo/);
		expect(perguntas).toMatch(/Onde está indo o meu dinheiro/);
		expect(perguntas).toMatch(/mínimo que eu posso cobrar/);
		expect(perguntas).toMatch(/desconto eu posso dar/);

		const piso = e.perguntas.find((q) => /mínimo/.test(q.pergunta));
		expect(piso?.resposta).toContain(brl(b.precos.precoUnitMinimoCents));
		const lucro = e.perguntas.find((q) => /ganhando/.test(q.pergunta));
		expect(lucro?.resposta).toContain(brl(b.precos.lucroPedidoCents));
	});

	it('o texto corrido traz preço, custo, alertas e nenhum campo cru', () => {
		const b = orca({ markupPct: 0.35 }, 100, { descontoPct: 0.4 });
		const e = explicaOrcamento(b);
		expect(e.texto).toContain(brl(b.precos.precoTotalCents));
		expect(e.texto).toContain('O CUSTO DA PEÇA');
		expect(e.texto).toContain('COMO O PREÇO FOI MONTADO');
		expect(e.texto).toContain('O QUE VOCÊ PRECISA OLHAR');
		// Nada de nome de campo de código no que o aluno lê.
		expect(e.texto).not.toMatch(/Cents|precoUnit|margemEfetiva|overheadPct/);
	});

	it('não recalcula nada: os números são os do breakdown, no centavo', () => {
		const b = orca({ impostoPct: 0.06 }, 37, { descontoPct: 0.05 });
		const e = explicaOrcamento(b);
		expect(e.titulo).toContain(brl(b.precos.precoTotalCents));
		expect(e.custo.porPeca).toBe(brl(b.custos.totalCents));
		expect(e.custo.doLote).toBe(brl(b.precos.custoLoteCents));
		for (const p of e.custo.parcelas) {
			if (p.id === 'overhead') continue;
			const linha = b.custos.linhas.find((l) => l.id === p.id);
			expect(p.valor).toBe(brl(linha?.cents ?? -1));
		}
	});
});

/* ──────────────── O dossiê: a única porta para um modelo ──────────────── */

describe('dossieParaModelo', () => {
	const CENARIOS: [string, () => QuoteBreakdown][] = [
		['pedido saudável', () => orca()],
		[
			'pedido no prejuízo',
			() => orca({ markupPct: 0.35 }, 100, { descontoPct: 0.4 }),
		],
		['pedido mínimo', () => orca({ pedidoMinimo: 500 }, 1)],
		[
			'velocidade estimada',
			() =>
				computeQuote(PECA, perfil(), {
					qty: 10,
					material: MDF,
					speed: {
						...VELOCIDADE_MEDIDA,
						source: 'modelo',
						confidence: 0.4,
						estimativa: true,
						avisos: ['velocidade é ESTIMATIVA'],
					},
				}),
		],
	];

	it.each(
		CENARIOS,
	)('em "%s", NENHUM valor do dossiê é número — nem por acidente', (_nome, monta) => {
		const dossie = dossieParaModelo(monta());
		for (const [caminho, valor] of folhas(dossie)) {
			expect(typeof valor, caminho).toBe('string');
			// E nenhum é um número disfarçado de texto ("13.50"): todo valor
			// carrega a unidade junto, então não dá para somar dois deles sem
			// escrever um parser de propósito.
			expect(String(valor), caminho).not.toMatch(/^-?[\d.,\s]+$/);
		}
	});

	it('o guarda recusa número solto e número disfarçado de texto', () => {
		// É esta função que faz a regra valer em tempo de execução: se alguém, um
		// dia, acrescentar um campo cru ao dossiê com um `as` no caminho, o
		// orçamento quebra ALTO em vez de entregar operandos a um modelo.
		expect(() => exigeTextoFormatado('preco_total', 13.5)).toThrow(/não-texto/);
		expect(() => exigeTextoFormatado('preco_total', '13.50')).toThrow(
			/número cru/,
		);
		expect(() => exigeTextoFormatado('preco_total', '1.234,56')).toThrow(
			/número cru/,
		);
		expect(() => exigeTextoFormatado('preco_total', 'R$ 13,50')).not.toThrow();
		expect(() => exigeTextoFormatado('margem', '47,8%')).not.toThrow();
	});

	it('o dossiê é congelado — nem o bloco que o monta muda um valor depois', () => {
		const dossie = dossieParaModelo(orca());
		expect(Object.isFrozen(dossie)).toBe(true);
		expect(() => {
			(dossie as unknown as Record<string, string>).preco_total = 'R$ 1,00';
		}).toThrow();
		expect(Object.isFrozen(dossie.alertas)).toBe(true);
	});

	it('leva os números FECHADOS, para o modelo não ter o que derivar', () => {
		const b = orca({ impostoPct: 0.06 }, 50, { descontoPct: 0.1 });
		const d = dossieParaModelo(b);
		// Preço, custo, lucro, margem, piso e teto: tudo pronto.
		expect(d.preco_por_peca).toBe(brl(b.precos.precoUnitCents));
		expect(d.preco_total).toBe(brl(b.precos.precoTotalCents));
		expect(d.custo_por_peca).toBe(brl(b.custos.totalCents));
		expect(d.custo_do_lote).toBe(brl(b.precos.custoLoteCents));
		expect(d.lucro_do_pedido).toContain(brl(b.precos.lucroPedidoCents));
		expect(d.preco_minimo_por_peca).toBe(brl(b.precos.precoUnitMinimoCents));
		expect(d.desconto_maximo).toBe(pctBR(b.precos.descontoMaximoPct, 1));
		expect(d.regra).toMatch(/não some, não converta/);
	});

	it('prejuízo chega ao modelo com essa palavra, não como número negativo', () => {
		const b = orca({ markupPct: 0.35 }, 100, { descontoPct: 0.4 });
		expect(b.precos.lucroPedidoCents).toBeLessThan(0);
		const d = dossieParaModelo(b);
		expect(d.lucro_do_pedido).toMatch(/PREJUÍZO/);
		expect(d.lucro_do_pedido).toContain(brl(-b.precos.lucroPedidoCents));
		expect(d.alertas.join(' ')).toMatch(/prejuízo/i);
	});

	it('a estimativa de velocidade vai junto — o modelo não pode omiti-la', () => {
		const b = computeQuote(PECA, perfil(), {
			qty: 10,
			material: MDF,
			speed: {
				...VELOCIDADE_MEDIDA,
				source: 'modelo',
				confidence: 0.4,
				estimativa: true,
				avisos: [],
			},
		});
		const d = dossieParaModelo(b);
		expect(d.confianca_da_velocidade).toMatch(/ESTIMATIVA/);
		expect(d.confianca_da_velocidade).toContain('40%');
	});
});
