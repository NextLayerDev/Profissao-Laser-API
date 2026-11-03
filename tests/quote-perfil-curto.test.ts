/**
 * O PERFIL CURTO — seis perguntas contra o paredão de 31 campos.
 *
 * O que estes testes protegem, em ordem de dano:
 *
 *  1. **O perfil curto e o perfil completo equivalente têm que dar o MESMO
 *     preço, ao centavo.** É a promessa inteira da mudança: derivar não é
 *     "aproximar", é preencher com um número declarado. Se divergirem, o aluno
 *     que respondeu seis perguntas está cobrando diferente de quem respondeu
 *     trinta e uma com os mesmos valores — e nenhuma tela consegue explicar
 *     isso.
 *  2. **Perfil legado continua valendo.** Existem zero perfis no banco hoje,
 *     mas o formato deles é público (o link de orçamento já emitido lê o mesmo
 *     `perfil_id`), e um registro completo do jeito antigo não pode mudar de
 *     preço por causa de um campo novo que ele não tem.
 *  3. **Branco não pode virar a máquina de outra pessoa.** Foi o modo de falha
 *     medido: perfil "CO2 100 W" com os derivados em branco herdava fibra de
 *     1500 W e cobrava +46% em silêncio.
 */

import { describe, expect, it } from 'vitest';
import type { CutSpeedResult } from '@/lib/quote/cut-speed.js';
import {
	CLASSE_OUTRA,
	DIAS_UTEIS_MES,
	derivarPerfilCurto,
	findMachineClass,
	IMPOSTO_POR_REGIME,
	MACHINE_CLASSES,
	machineClassIds,
	machineFieldsSpec,
	machineFromCollectionData,
	VIDA_ANOS,
} from '@/lib/quote/machines.js';
import type { MaterialInput } from '@/lib/quote/materials.js';
import {
	camposEmBrancoDoPerfil,
	computeQuote,
	DEFAULT_PROFILE,
	profileFieldsSpec,
	profileFromCollectionData,
	profileToCollectionData,
	type QuoteMetrics,
	taxaHoraMaquina,
} from '@/lib/quote/pricing.js';

/* ─────────────────────────── Fixtures ─────────────────────────── */

/** Peça de 200×150 com 4 furos — o trabalho de marcenaria típico. */
const PECA: QuoteMetrics = {
	cutLengthMm: 700 + 4 * Math.PI * 6,
	pierces: 5,
	netAreaMm2: 200 * 150 - 4 * Math.PI * 9,
	bboxAreaMm2: 200 * 150,
	bbox: { w: 200, h: 150 },
};

const MDF_3MM: MaterialInput = {
	nome: 'MDF 3 mm',
	familia: 'mdf',
	espessuraMm: 3,
	precoKg: 8,
	densidade: 0.75,
	chapaWmm: 2750,
	chapaHmm: 1830,
};

/** Velocidade FIRME de propósito: o assunto aqui é o perfil, não a cascata. */
const VELOCIDADE: CutSpeedResult = {
	speedMmS: 18,
	passes: 1,
	pierceS: 0.5,
	source: 'curated',
	confidence: 1,
	estimativa: false,
	avisos: [],
	detalhe: 'fixture',
};

const PEDIDO = { qty: 10, material: MDF_3MM, speed: VELOCIDADE } as const;

/* ══════════════════ 1. Curto = completo, ao centavo ══════════════════ */

describe('perfil curto × perfil completo', () => {
	/**
	 * O PORTÃO DA FASE. À esquerda, seis respostas. À direita, os mesmos valores
	 * digitados um a um do jeito antigo. Os dois têm que sair no mesmo centavo —
	 * senão "derivar" virou "chutar", e chute não fecha preço.
	 */
	it('o perfil de seis perguntas dá o MESMO preço do perfil de 31 campos', () => {
		const curto = derivarPerfilCurto({
			maquinaClasse: 'co2_100',
			horasUteisDia: 8,
			ganhoMensal: 4400,
			markupPct: 100,
			regimeFiscal: 'simples_servicos',
			pedidoMinimo: 50,
		});

		// O que um aluno teimoso digitaria à mão, campo a campo, para chegar na
		// MESMA oficina. Nada aqui é copiado de `curto.data`: é escrito na unha,
		// ou o teste só provaria que a função concorda consigo mesma.
		const completo: Record<string, unknown> = {
			laser: 'co2',
			potencia_w: 100,
			v_grav_mm_s: 350,
			line_mm: 0.08,
			ineficiencia_pct: 15,
			setup_min: 5,
			tempo_manual_min: 0,
			energia_kw: 2.2,
			preco_kwh: 0.85,
			gas_m3h: 0,
			preco_gas_m3: 0,
			consumiveis_hora: 0.25,
			manutencao_hora: 1,
			valor_maquina: 29500,
			// 8 h × 22 dias × 12 meses × 10 anos
			vida_util_h: 21120,
			// R$ 4.400 ÷ (8 × 22)
			custo_hora_operador: 25,
			supervisao_pct: 35,
			acabamento_por_peca: 0,
			overhead_pct: 20,
			markup_pct: 100,
			// 100/(100+100)
			margem_pct: 50,
			imposto_pct: 6,
			precificar_por: 'markup',
			arredondamento: '0.50',
			pedido_minimo: 50,
			horas_uteis_dia: 8,
			prazo_base_dias: 2,
			material_basis: 'bbox',
			aproveitamento_pct: 75,
			descontos: '',
		};

		const pCurto = profileFromCollectionData(curto.data);
		const pCompleto = profileFromCollectionData(completo);
		expect(pCurto).toEqual(pCompleto);

		const qCurto = computeQuote(PECA, pCurto, PEDIDO);
		const qCompleto = computeQuote(PECA, pCompleto, PEDIDO);
		expect(qCurto.precos.precoUnitCents).toBe(qCompleto.precos.precoUnitCents);
		expect(qCurto.precos.precoTotalCents).toBe(
			qCompleto.precos.precoTotalCents,
		);
		expect(qCurto.custos.totalCents).toBe(qCompleto.custos.totalCents);
	});

	it('as seis respostas cobrem os 31 campos — nenhum sai em branco', () => {
		const { data } = derivarPerfilCurto({ maquinaClasse: 'fibra_30' });
		expect(camposEmBrancoDoPerfil(data)).toEqual([]);
		// E todo campo gravado é DECLARADO na coleção: o que não é declarado é
		// descartado em silêncio na gravação, e o aluno acharia que salvou.
		const declarados = new Set(profileFieldsSpec().map((f) => f.name));
		for (const campo of Object.keys(data)) expect(declarados).toContain(campo);
	});

	it('as contas derivadas são as declaradas (vida útil, hora do dono, margem)', () => {
		const { data } = derivarPerfilCurto({
			maquinaClasse: 'co2_60',
			horasUteisDia: 6,
			ganhoMensal: 6600,
			markupPct: 200,
			regimeFiscal: 'mei',
		});
		expect(data.vida_util_h).toBe(6 * DIAS_UTEIS_MES * 12 * VIDA_ANOS);
		expect(data.custo_hora_operador).toBe(6600 / (6 * DIAS_UTEIS_MES)); // R$ 50/h
		// markup 200% ⇒ margem 66,67% — a MESMA decisão, na outra escala.
		expect(Number(data.margem_pct)).toBeCloseTo(200 / 3, 4);
		expect(data.imposto_pct).toBe(IMPOSTO_POR_REGIME.mei);
	});

	it('markup e margem derivados são de fato equivalentes no preço', () => {
		const { data } = derivarPerfilCurto({
			maquinaClasse: 'co2_100',
			markupPct: 35,
		});
		const p = profileFromCollectionData(data);
		const porMarkup = computeQuote(PECA, p, {
			...PEDIDO,
			precificarPor: 'markup',
		});
		const porMargem = computeQuote(PECA, p, {
			...PEDIDO,
			precificarPor: 'margem',
		});
		expect(porMarkup.precos.precoUnitCents).toBe(
			porMargem.precos.precoUnitCents,
		);
	});
});

/* ══════════════════ 2. O padrão por máquina ══════════════════ */

describe('padrão por máquina', () => {
	it('cada classe do parque entrega a própria taxa-hora, e não a de uma fibra 1500 W', () => {
		const taxaPadraoAntiga = taxaHoraMaquina(DEFAULT_PROFILE);
		for (const classe of MACHINE_CLASSES) {
			const { data } = derivarPerfilCurto({ maquinaClasse: classe.id });
			const p = profileFromCollectionData(data);
			expect(p.laser).toBe(classe.laser);
			expect(p.potenciaW).toBe(classe.potenciaW);
			// Nenhuma máquina real deste público chega perto da taxa da 1500 W —
			// era esse o sobrepreço que o padrão antigo embutia.
			expect(taxaHoraMaquina(p)).toBeLessThan(taxaPadraoAntiga);
		}
	});

	it('fibra galvo não cobra o dobro do tempo de gravação (o furo do padrão antigo)', () => {
		// O parque real faz 1500 mm/s × line 0,04 = 60 mm²/s; o padrão antigo era
		// 300 × 0,1 = 30 mm²/s, ou seja, o DOBRO do tempo para a mesma gravação.
		const { data } = derivarPerfilCurto({ maquinaClasse: 'fibra_20' });
		const p = profileFromCollectionData(data);
		expect(p.vGravMmS * p.lineMm).toBeCloseTo(60, 6);
		expect(DEFAULT_PROFILE.vGravMmS * DEFAULT_PROFILE.lineMm).toBeCloseTo(
			30,
			6,
		);
	});

	it('CO2 assume tubo a R$ 0,25/h e nenhuma máquina assume gás', () => {
		for (const classe of MACHINE_CLASSES) {
			expect(classe.gasM3h).toBe(0);
			expect(classe.precoGasM3).toBe(0);
			if (classe.laser === 'co2')
				expect(classe.consumiveisHora).toBeLessThanOrEqual(0.3);
			else expect(classe.consumiveisHora).toBe(0);
		}
	});

	it('"outra máquina" não inventa classe — deriva sem tocar em laser/potência', () => {
		const { data, assumidos, maquina } = derivarPerfilCurto({
			maquinaClasse: CLASSE_OUTRA,
		});
		expect(maquina).toBeNull();
		expect(data.laser).toBeUndefined();
		expect(data.potencia_w).toBeUndefined();
		// O que NÃO depende da máquina continua vindo pronto.
		expect(data.markup_pct).toBe(100);
		expect(assumidos.some((a) => a.campo === 'laser')).toBe(false);
	});

	it('classe inexistente é erro, não silêncio', () => {
		expect(() => derivarPerfilCurto({ maquinaClasse: 'co2_9000' })).toThrow(
			/não está na tabela/,
		);
	});

	it('toda origem assumida tem um texto em português para a tela mostrar', () => {
		const { assumidos } = derivarPerfilCurto({ maquinaClasse: 'co2_100' });
		expect(assumidos.length).toBeGreaterThan(10);
		for (const a of assumidos) {
			expect(a.fonte.length).toBeGreaterThan(5);
			expect(['maquina', 'calculo', 'padrao']).toContain(a.origem);
		}
		// A resposta do aluno não entra na lista do que foi "assumido".
		expect(assumidos.some((a) => a.campo === 'pedido_minimo')).toBe(false);
		const valor = assumidos.find((a) => a.campo === 'valor_maquina');
		expect(valor?.fonte).toMatch(/CO2 100 W/);
	});
});

/* ══════════════════ 3. A tabela como COLEÇÃO (o admin discorda) ══════════════════ */

describe('tabela de máquinas na coleção', () => {
	it('a linha da coleção sobrescreve o lastro em código, campo a campo', () => {
		// O admin descobriu que o tubo está R$ 3.200 e mexeu numa célula só.
		const m = machineFromCollectionData({
			classe_id: 'co2_100',
			consumiveis_hora: 0.4,
		});
		expect(m.consumiveisHora).toBe(0.4);
		// O resto continua vindo do lastro — não virou cadastro inteiro.
		expect(m.valorMaquina).toBe(findMachineClass('co2_100')?.valorMaquina);
		expect(m.laser).toBe('co2');
	});

	it('classe que só existe na coleção nasce de uma semente que fecha a conta', () => {
		const m = machineFromCollectionData(
			{
				classe_id: 'co2_180',
				laser: 'co2',
				potencia_w: 180,
				valor_maquina: 72000,
			},
			'CO2 180 W importada',
		);
		expect(m.id).toBe('co2_180');
		expect(m.potenciaW).toBe(180);
		expect(m.label).toBe('CO2 180 W importada');
		// Campo não declarado não vira NaN: cai na semente.
		expect(Number.isFinite(m.energiaKw)).toBe(true);
		const { data } = derivarPerfilCurto({ maquinaClasse: 'co2_180' }, m);
		expect(data.valor_maquina).toBe(72000);
	});

	it('recusa laser inválido e valor fora de faixa em vez de gravar lixo', () => {
		expect(() =>
			machineFromCollectionData({ classe_id: 'x', laser: 'plasma' }),
		).toThrow(/inválido/);
		expect(() =>
			machineFromCollectionData({ classe_id: 'co2_100', energia_kw: -3 }),
		).toThrow(/fora da faixa/);
		expect(() => machineFromCollectionData({})).toThrow(/classe_id/);
	});

	it('a spec da coleção declara todo campo que o parser lê', () => {
		const nomes = new Set(machineFieldsSpec().map((f) => f.name));
		expect(nomes).toContain('classe_id');
		for (const campo of [
			'laser',
			'potencia_w',
			'consumiveis_hora',
			'valor_maquina',
		]) {
			expect(nomes).toContain(campo);
		}
		// Só a identificação é obrigatória: a linha é um PATCH sobre o lastro.
		const obrigatorios = machineFieldsSpec()
			.filter((f) => f.required)
			.map((f) => f.name);
		expect(obrigatorios.sort()).toEqual(['classe_id', 'laser']);
	});
});

/* ══════════════════ 4. O aluno discorda ══════════════════ */

describe('o aluno sobrescreve um derivado', () => {
	it('o número corrigido vence o padrão e chega ao preço', () => {
		const base = derivarPerfilCurto({ maquinaClasse: 'co2_100' });
		const corrigido = { ...base.data, consumiveis_hora: 1.5 };

		const antes = profileFromCollectionData(base.data);
		const depois = profileFromCollectionData(corrigido);
		expect(depois.consumiveisHora).toBe(1.5);
		expect(taxaHoraMaquina(depois)).toBeCloseTo(
			taxaHoraMaquina(antes) + 1.25,
			6,
		);

		const qAntes = computeQuote(PECA, antes, PEDIDO);
		const qDepois = computeQuote(PECA, depois, PEDIDO);
		expect(qDepois.custos.totalCents).toBeGreaterThan(qAntes.custos.totalCents);
	});

	it('corrigir a hora do dono não desfaz o resto da derivação', () => {
		const { data } = derivarPerfilCurto({
			maquinaClasse: 'fibra_50',
			ganhoMensal: 4400,
		});
		const p = profileFromCollectionData({ ...data, custo_hora_operador: 60 });
		expect(p.custoHoraOperador).toBe(60);
		expect(p.potenciaW).toBe(50);
		expect(p.vidaUtilH).toBe(data.vida_util_h);
	});

	it('percentual corrigido continua entrando em FRAÇÃO no perfil', () => {
		// A armadilha nº 1 do precificador: `overheadPct: 35` multiplicaria o
		// custo por 36. A escala da coleção é 0–100 e a do perfil é fração.
		const { data } = derivarPerfilCurto({ maquinaClasse: 'co2_60' });
		const p = profileFromCollectionData({
			...data,
			overhead_pct: 35,
			supervisao_pct: 80,
		});
		expect(p.overheadPct).toBeCloseTo(0.35, 9);
		expect(p.fatorSupervisao).toBeCloseTo(0.8, 9);
	});
});

/* ══════════════════ 5. O perfil legado ══════════════════ */

describe('perfil legado', () => {
	/**
	 * Este é o `data` EXATO que o formulário antigo gravava: os 31 campos, todos
	 * preenchidos, nenhum `maquina_classe`. É a forma dos perfis que existem no
	 * banco (hoje, zero — mas o link público já emitido lê por `perfil_id` e o
	 * formato é contrato).
	 */
	const LEGADO: Record<string, unknown> = {
		laser: 'co2',
		potencia_w: 100,
		v_rapid_mm_s: 250,
		v_grav_mm_s: 200,
		line_mm: 0.15,
		ineficiencia_pct: 15,
		setup_min: 5,
		tempo_manual_min: 2,
		energia_kw: 2,
		preco_kwh: 0.95,
		gas_m3h: 0,
		preco_gas_m3: 0,
		consumiveis_hora: 1.2,
		manutencao_hora: 1,
		valor_maquina: 25000,
		vida_util_h: 12000,
		custo_hora_operador: 22,
		supervisao_pct: 35,
		acabamento_por_peca: 3,
		overhead_pct: 20,
		markup_pct: 100,
		margem_pct: 50,
		imposto_pct: 6,
		precificar_por: 'markup',
		arredondamento: '0.50',
		pedido_minimo: 50,
		horas_uteis_dia: 8,
		prazo_base_dias: 2,
		material_basis: 'bbox',
		aproveitamento_pct: 75,
		descontos: '10:5\n50:10\n100:15',
	};

	it('lê campo a campo exatamente como antes (sem maquina_classe no registro)', () => {
		const p = profileFromCollectionData(LEGADO);
		expect(p.laser).toBe('co2');
		expect(p.potenciaW).toBe(100);
		expect(p.vRapidMmS).toBe(250);
		expect(p.vGravMmS).toBe(200);
		expect(p.lineMm).toBe(0.15);
		expect(p.setupS).toBe(300);
		expect(p.consumiveisHora).toBe(1.2);
		expect(p.valorMaquina).toBe(25000);
		expect(p.vidaUtilH).toBe(12000);
		expect(p.custoHoraOperador).toBe(22);
		expect(p.fatorSupervisao).toBeCloseTo(0.35, 9);
		expect(p.acabamentoPorPeca).toBe(3);
		expect(p.overheadPct).toBeCloseTo(0.2, 9);
		expect(p.markupPct).toBeCloseTo(1, 9);
		expect(p.impostoPct).toBeCloseTo(0.06, 9);
		expect(p.descontos).toEqual([
			{ minQtd: 10, pct: 0.05 },
			{ minQtd: 50, pct: 0.1 },
			{ minQtd: 100, pct: 0.15 },
		]);
	});

	/**
	 * O NÚMERO CONGELADO. Se alguém mudar a base do merge, o padrão de uma
	 * classe ou a ordem de aplicação, é AQUI que quebra — antes de quebrar no
	 * orçamento de alguém.
	 */
	it('o preço do perfil legado não se move (valor congelado)', () => {
		const q = computeQuote(PECA, profileFromCollectionData(LEGADO), PEDIDO);
		expect(q.custos.totalCents).toBe(551); // R$ 5,51 por peça
		expect(q.precos.precoUnitCents).toBe(1200); // R$ 12,00
		expect(q.precos.precoTotalCents).toBe(11400); // 10 × 12,00 − 5% de faixa
	});

	it('round-trip do perfil padrão continua fechando (os campos novos não vazam)', () => {
		const data = profileToCollectionData(DEFAULT_PROFILE);
		expect(profileFromCollectionData(data)).toEqual(DEFAULT_PROFILE);
		expect(data.maquina_classe).toBeUndefined();
		expect(data.ganho_mensal).toBeUndefined();
		expect(data.regime_fiscal).toBeUndefined();
	});

	it('perfil PARCIAL parte da máquina declarada, não de uma fibra de 1500 W', () => {
		// Era +46% de sobrepreço em silêncio: o registro dizia CO2 100 W e o
		// merge partia da fibra 1500 W (R$ 180.000, 6 kW, consumíveis R$ 3/h).
		const parcial = {
			maquina_classe: 'co2_100',
			markup_pct: 100,
			pedido_minimo: 50,
		};
		const p = profileFromCollectionData(parcial);
		expect(p.laser).toBe('co2');
		expect(p.valorMaquina).toBe(29500);
		expect(p.energiaKw).toBe(2.2);
		expect(taxaHoraMaquina(p)).toBeLessThan(
			taxaHoraMaquina(DEFAULT_PROFILE) / 2,
		);
	});

	it('sem classe e sem laser, o padrão de sempre — e ninguém mutou a constante', () => {
		const antes = { ...DEFAULT_PROFILE };
		const p = profileFromCollectionData({ overhead_pct: 35 });
		expect(p.overheadPct).toBeCloseTo(0.35, 9);
		// O bug que a suíte pegou: `baseDoPerfil` devolvia a CONSTANTE do módulo
		// e o loop escrevia por cima dela, contaminando todo orçamento seguinte.
		expect(DEFAULT_PROFILE).toEqual(antes);
	});

	it('o enum de maquina_classe declarado na coleção bate com a tabela', () => {
		const campo = profileFieldsSpec().find((f) => f.name === 'maquina_classe');
		expect(campo?.options).toEqual(machineClassIds());
		expect(campo?.options).toContain(CLASSE_OUTRA);
	});

	it('nenhum campo do perfil é obrigatório — o muro caiu', () => {
		expect(profileFieldsSpec().filter((f) => f.required)).toEqual([]);
	});
});
