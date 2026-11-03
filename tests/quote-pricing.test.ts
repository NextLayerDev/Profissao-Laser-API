import { describe, expect, it } from 'vitest';
import {
	CONFIANCA,
	type CommunitySpeedRow,
	type CuratedSpeedRow,
	type CutSpeedResult,
	mediana,
	pierceFallbackS,
	resolveCutSpeed,
} from '@/lib/quote/cut-speed.js';
import { brl, pctBR } from '@/lib/quote/format.js';
import {
	APROVEITAMENTO_PADRAO,
	areaCobradaMm2,
	DENSIDADES,
	densidadeDe,
	type MaterialInput,
	pecasPorChapa,
	pesoKg,
	SEED_MATERIAIS_HEADER,
	seedMateriaisCsv,
} from '@/lib/quote/materials.js';
import {
	arredondaCents,
	computeQuote,
	DEFAULT_PROFILE,
	DEFAULT_PROFILE_CO2,
	defaultProfileFor,
	faixaDesconto,
	parseDescontos,
	prefixaAlertas,
	profileFieldsSpec,
	profileFromCollectionData,
	profileToCollectionData,
	type QuoteMetrics,
	type QuoteProfile,
	taxaHoraMaquina,
	travelOrder,
} from '@/lib/quote/pricing.js';

/* ─────────────────────────── Fixtures ─────────────────────────── */

/** Chapa de 1 m² (1000×1000 mm) — o caso de conferência de peso. */
const METRO_QUADRADO: QuoteMetrics = {
	cutLengthMm: 4000,
	pierces: 1,
	netAreaMm2: 1_000_000,
	bboxAreaMm2: 1_000_000,
	bbox: { w: 1000, h: 1000 },
};

/** Peça de 100×100 com um furo de 20 mm no meio. */
const PLACA: QuoteMetrics = {
	cutLengthMm: 400 + Math.PI * 20,
	pierces: 2,
	netAreaMm2: 100 * 100 - Math.PI * 10 * 10,
	bboxAreaMm2: 10_000,
	bbox: { w: 100, h: 100 },
	entryPoints: [
		{ x: 0, y: 0 },
		{ x: 40, y: 50 },
	],
};

const ACO_1MM: MaterialInput = {
	nome: 'Aço carbono 1 mm',
	familia: 'aço carbono',
	espessuraMm: 1,
	precoKg: 10,
	chapaWmm: 2000,
	chapaHmm: 1000,
};

const VELOCIDADE_FIRME: CutSpeedResult = {
	speedMmS: 40,
	passes: 1,
	pierceS: 0.55,
	source: 'curated',
	confidence: 1,
	estimativa: false,
	avisos: [],
	detalhe: 'fixture',
};

function perfil(over: Partial<QuoteProfile> = {}): QuoteProfile {
	return { ...DEFAULT_PROFILE, ...over };
}

/** Anda na saída inteira e devolve todo par [caminho, valor] de dinheiro. */
function camposDeDinheiro(obj: unknown, caminho = ''): [string, unknown][] {
	if (Array.isArray(obj)) {
		return obj.flatMap((v, i) => camposDeDinheiro(v, `${caminho}[${i}]`));
	}
	if (obj && typeof obj === 'object') {
		return Object.entries(obj).flatMap(([k, v]) => {
			const p = caminho ? `${caminho}.${k}` : k;
			// Campo ausente (material cobrado por kg não tem preço por m²) não é
			// candidato: o teste cobra INTEIRO de quem existe.
			if (v === undefined) return [];
			if (/(^|[a-z])cents$/i.test(k)) return [[p, v] as [string, unknown]];
			return camposDeDinheiro(v, p);
		});
	}
	return [];
}

/* ─────────────────────────── Peso e material ─────────────────────────── */

describe('materiais', () => {
	it('1 m² de aço 1 mm pesa 7,85 kg', () => {
		expect(pesoKg(1_000_000, 1, DENSIDADES['aço carbono'])).toBeCloseTo(
			7.85,
			6,
		);
	});

	it('peso escala com espessura e área', () => {
		expect(pesoKg(1_000_000, 2, 7.85)).toBeCloseTo(15.7, 6);
		expect(pesoKg(500_000, 1, 7.85)).toBeCloseTo(3.925, 6);
	});

	it('densidade resolve acento, caixa, apelido e sufixo', () => {
		expect(densidadeDe('aco carbono')).toBe(7.85);
		expect(densidadeDe('AÇO CARBONO')).toBe(7.85);
		expect(densidadeDe('Aço 1020')).toBe(7.85);
		expect(densidadeDe('Inox 304 escovado')).toBe(7.93);
		expect(densidadeDe('inox')).toBe(7.93);
		expect(densidadeDe('Acrilico')).toBe(1.19);
		expect(densidadeDe('unobtainium')).toBeUndefined();
	});

	it('grid de peças por chapa conta as duas orientações', () => {
		// Chapa 1000×1000 com margem 10 → útil 980×980; peça 100×200 + gap 5.
		// reto:   floor(985/105)=9 × floor(985/205)=4 → 36
		// girado: floor(985/205)=4 × floor(985/105)=9 → 36
		expect(pecasPorChapa(100, 200, 1000, 1000)).toBe(36);
		// Peça alta demais para a chapa deitada: só entra girada.
		expect(pecasPorChapa(100, 500, 1000, 400)).toBe(3);
		expect(pecasPorChapa(100, 500, 1000, 400, { permitirRotacao: false })).toBe(
			0,
		);
		expect(pecasPorChapa(2000, 2000, 1000, 1000)).toBe(0);
	});

	it('área cobrada muda com a política e nunca fica abaixo da líquida', () => {
		const m = {
			netAreaMm2: PLACA.netAreaMm2,
			bboxAreaMm2: PLACA.bboxAreaMm2,
			bbox: PLACA.bbox,
		};
		const liquido = areaCobradaMm2(m, { ...ACO_1MM, basis: 'liquido' });
		expect(liquido.areaMm2).toBeCloseTo(
			m.netAreaMm2 / APROVEITAMENTO_PADRAO,
			6,
		);

		const bbox = areaCobradaMm2(m, { ...ACO_1MM, basis: 'bbox' });
		expect(bbox.areaMm2).toBe(10_000);

		// 2000×1000, margem 10 → útil 1980×980; peça 100 + gap 5 → 18 × 9 = 162
		// Num lote que enche a chapa exatamente, cada peça paga 1/162 dela.
		const chapa = areaCobradaMm2(
			m,
			{ ...ACO_1MM, basis: 'chapa' },
			{ qty: 162 },
		);
		expect(chapa.pecasPorChapa).toBe(162);
		expect(chapa.chapas).toBe(1);
		expect(chapa.areaMm2).toBeCloseTo(2_000_000 / 162, 6);
		expect(chapa.areaMm2).toBeGreaterThan(bbox.areaMm2);
	});

	it('cobrança por chapa cobra as chapas INTEIRAS que o pedido consome', () => {
		// O BURACO QUE ESTE TESTE FECHA: a conta era `chapa ÷ peças que cabem`,
		// sem olhar a quantidade. Quem pedia 1 peça pagava 1/162 de uma chapa que
		// comprou inteira, e quem pedia 163 pagava 163/162 — quer dizer, UMA chapa
		// e um pedacinho, tendo comprado DUAS. O resto saía do bolso dele.
		const m = {
			netAreaMm2: PLACA.netAreaMm2,
			bboxAreaMm2: PLACA.bboxAreaMm2,
			bbox: PLACA.bbox,
		};
		const porChapa = { ...ACO_1MM, basis: 'chapa' as const };
		const CHAPA_MM2 = 2000 * 1000;

		// 1 peça = 1 chapa comprada. É o que "cobrar por chapa" quer dizer.
		const uma = areaCobradaMm2(m, porChapa, { qty: 1 });
		expect(uma.chapas).toBe(1);
		expect(uma.areaMm2).toBe(CHAPA_MM2);
		expect(uma.sobraPecas).toBe(161);

		// A chapa cheia: nada de sobra, e nenhum aviso sobre ela.
		const cheia = areaCobradaMm2(m, porChapa, { qty: 162 });
		expect(cheia.chapas).toBe(1);
		expect(cheia.sobraPecas).toBe(0);
		expect(cheia.avisos).toEqual([]);

		// Uma peça a mais abre a SEGUNDA chapa — e ela entra no preço inteira.
		const passouUma = areaCobradaMm2(m, porChapa, { qty: 163 });
		expect(passouUma.chapas).toBe(2);
		expect(passouUma.areaMm2).toBeCloseTo((2 * CHAPA_MM2) / 163, 6);
		expect(passouUma.areaMm2).toBeGreaterThan(cheia.areaMm2);
		expect(passouUma.avisos.join(' ')).toMatch(/2 chapas/);
		expect(passouUma.avisos.join(' ')).toMatch(/161 peças/);
	});

	it('cobrança por chapa exige as medidas da chapa', () => {
		expect(() =>
			areaCobradaMm2(
				{ netAreaMm2: 1, bboxAreaMm2: 1, bbox: { w: 1, h: 1 } },
				{ nome: 'x', espessuraMm: 1, precoKg: 1, basis: 'chapa' },
			),
		).toThrow(/medidas da chapa/);
	});

	it('seed do CSV está consistente com DENSIDADES e é CSV seguro', () => {
		const csv = seedMateriaisCsv();
		const linhas = csv.split('\n');
		expect(linhas[0]).toBe(SEED_MATERIAIS_HEADER.join(','));
		expect(linhas.length).toBeGreaterThan(15);

		for (const linha of linhas.slice(1)) {
			const cols = linha.split(',');
			expect(cols).toHaveLength(SEED_MATERIAIS_HEADER.length);
			// Nenhum campo com vírgula/aspas/quebra: o seed pode ser concatenado
			// sem escape (é a premissa do comentário em seedMateriaisCsv).
			expect(linha).not.toMatch(/["\r]/);
			const [, familia, densidade] = cols;
			expect(Number(densidade)).toBe(densidadeDe(familia));
		}
	});

	it('marca no seed os materiais que NÃO se cortam a laser', () => {
		const csv = seedMateriaisCsv();
		const pvc = csv.split('\n').find((l) => l.startsWith('PVC,'));
		expect(pvc?.endsWith(',nao')).toBe(true);
	});
});

/* ─────────────────────── Cascata de velocidade ─────────────────────── */

describe('resolveCutSpeed — cascata e confiança', () => {
	const base = {
		familia: 'aço carbono',
		espessuraMm: 3,
		laser: 'fibra' as const,
		potenciaW: 1500,
	};

	it('nível 1: coleção curada → confiança 1', () => {
		const curated: CuratedSpeedRow[] = [
			{ espessuraMm: 1, speedMmS: 120 },
			{
				espessuraMm: 3,
				speedMmS: 40,
				passes: 1,
				pierceS: 0.9,
				potenciaW: 1500,
			},
		];
		const r = resolveCutSpeed(base, { curated });
		expect(r.source).toBe('curated');
		expect(r.confidence).toBe(CONFIANCA.curada);
		expect(r.speedMmS).toBe(40);
		expect(r.pierceS).toBe(0.9);
		expect(r.estimativa).toBe(false);
	});

	it('curada de espessura vizinha vale menos e avisa', () => {
		const r = resolveCutSpeed(base, {
			curated: [{ espessuraMm: 2.5, speedMmS: 50 }],
		});
		expect(r.source).toBe('curated');
		expect(r.confidence).toBe(CONFIANCA.curadaAjustada);
		expect(r.avisos.join(' ')).toMatch(/2\.5 mm/);
	});

	it('curada medida em outra potência é convertida por (P/Pref)^0,7', () => {
		const r = resolveCutSpeed(base, {
			curated: [{ espessuraMm: 3, speedMmS: 30, potenciaW: 1000 }],
		});
		expect(r.source).toBe('curated');
		expect(r.confidence).toBe(CONFIANCA.curadaAjustada);
		expect(r.speedMmS).toBeCloseTo(30 * (1500 / 1000) ** 0.7, 6);
	});

	it('nível 2: mediana da comunidade → confiança 0,7 e outlier ignorado', () => {
		const community: CommunitySpeedRow[] = [
			{ espessuraMm: 3, speedMmS: 30 },
			{ espessuraMm: 3, speedMmS: 35 },
			{ espessuraMm: 3, speedMmS: 400 }, // aluno com parâmetro absurdo
		];
		const r = resolveCutSpeed(base, { community });
		expect(r.source).toBe('community');
		expect(r.confidence).toBe(CONFIANCA.comunidade);
		expect(r.amostras).toBe(3);
		expect(r.speedMmS).toBe(35); // mediana, não média (que daria 155)
		expect(r.estimativa).toBe(false);
	});

	it('comunidade com 1–2 amostras cai para 0,55 e vira estimativa', () => {
		const r = resolveCutSpeed(base, {
			community: [{ espessuraMm: 3, speedMmS: 33 }],
		});
		expect(r.confidence).toBe(CONFIANCA.comunidadePoucas);
		expect(r.estimativa).toBe(true);
		expect(r.avisos.join(' ')).toMatch(/mediana ainda não filtra outlier/);
	});

	it('comunidade em espessura distante é descartada (cai no modelo)', () => {
		const r = resolveCutSpeed(base, {
			community: [{ espessuraMm: 8, speedMmS: 12 }],
		});
		expect(r.source).toBe('modelo');
	});

	it('nível 3: curva paramétrica → confiança 0,4', () => {
		const r = resolveCutSpeed(base, {});
		expect(r.source).toBe('modelo');
		expect(r.confidence).toBe(CONFIANCA.modelo);
		expect(r.speedMmS).toBeCloseTo(130 / 3 ** 1.15, 6);
		expect(r.estimativa).toBe(true);
		expect(r.avisos.join(' ')).toMatch(/ESTIMATIVA/);
	});

	it('a curva escala com a potência pelo expoente 0,7', () => {
		const dobro = resolveCutSpeed({ ...base, potenciaW: 3000 }, {});
		const simples = resolveCutSpeed(base, {});
		expect(dobro.speedMmS / simples.speedMmS).toBeCloseTo(2 ** 0.7, 6);
	});

	it('override manual vence a cascata inteira', () => {
		const r = resolveCutSpeed(
			{ ...base, speedMmS: 22, passes: 2 },
			{ curated: [{ espessuraMm: 3, speedMmS: 40 }] },
		);
		expect(r.source).toBe('manual');
		expect(r.speedMmS).toBe(22);
		expect(r.passes).toBe(2);
		expect(r.confidence).toBe(1);
	});

	it('material sem curva no laser pedido dá erro em vez de preço inventado', () => {
		expect(() => resolveCutSpeed({ ...base, familia: 'pvc' }, {})).toThrow(
			/sem velocidade de corte/,
		);
		expect(() =>
			resolveCutSpeed({ ...base, familia: 'mdf', laser: 'fibra' }, {}),
		).toThrow(/não é material de laser fibra/);
	});

	it('pierce de fallback segue a fórmula de cada laser', () => {
		expect(pierceFallbackS(3, 'fibra')).toBeCloseTo(0.2 + 0.35 * 3, 9);
		expect(pierceFallbackS(3, 'co2')).toBeCloseTo(0.5 + 0.2 * 3, 9);
	});

	it('mediana é mediana', () => {
		expect(mediana([5, 1, 3])).toBe(3);
		expect(mediana([1, 2, 3, 10])).toBe(2.5);
	});
});

/* ─────────────────────── Deslocamento (TSP) ─────────────────────── */

describe('travelOrder', () => {
	it('3 pontos colineares: caminho ótimo', () => {
		const pts = [
			{ x: 0, y: 0 },
			{ x: 20, y: 0 },
			{ x: 10, y: 0 },
		];
		const r = travelOrder(pts);
		// Origem padrão = (minX, maxY) = (0,0) → 0 → 10 → 20.
		expect(r.order).toEqual([0, 2, 1]);
		expect(r.lengthMm).toBeCloseTo(20, 9);
	});

	it('respeita a origem informada', () => {
		const pts = [
			{ x: 0, y: 0 },
			{ x: 20, y: 0 },
			{ x: 10, y: 0 },
		];
		const r = travelOrder(pts, { start: { x: 30, y: 0 } });
		expect(r.order).toEqual([1, 2, 0]);
		expect(r.lengthMm).toBeCloseTo(30, 9);
	});

	it('2-opt desfaz o cruzamento que o vizinho-mais-próximo cria', () => {
		// O NN desce até (90,10) e ainda precisa voltar lá em cima buscar (50,100):
		// o caminho cruza consigo mesmo. O 2-opt reverte o trecho e tira o cruzamento.
		const pts = [
			{ x: 70, y: 40 },
			{ x: 50, y: 100 },
			{ x: 20, y: 50 },
			{ x: 90, y: 10 },
			{ x: 10, y: 90 },
		];
		const start = { x: 0, y: 100 };
		const sem = travelOrder(pts, { start, twoOptMaxN: 0 });
		const com = travelOrder(pts, { start });
		expect(sem.twoOpt).toBe(false);
		expect(sem.order).toEqual([4, 2, 0, 3, 1]);
		expect(sem.lengthMm).toBeCloseTo(240.9075, 3);
		expect(com.twoOpt).toBe(true);
		expect(com.order).toEqual([4, 1, 2, 0, 3]);
		expect(com.lengthMm).toBeCloseTo(200.7284, 3);
		// ~17% de deslocamento a menos, no mesmo arquivo.
		expect(com.lengthMm).toBeLessThan(sem.lengthMm);
	});

	it('acima do teto de contornos não roda 2-opt', () => {
		const pts = Array.from({ length: 12 }, (_, i) => ({
			x: i * 3,
			y: (i % 5) * 7,
		}));
		expect(travelOrder(pts, { twoOptMaxN: 5 }).twoOpt).toBe(false);
		expect(travelOrder(pts, { twoOptMaxN: 50 }).twoOpt).toBe(true);
	});

	it('visita todos os pontos exatamente uma vez, com grade espacial', () => {
		const pts = Array.from({ length: 300 }, (_, i) => ({
			x: (i * 37) % 500,
			y: (i * 91) % 400,
		}));
		const r = travelOrder(pts);
		expect(r.order).toHaveLength(300);
		expect(new Set(r.order).size).toBe(300);
		expect(r.twoOpt).toBe(false); // n > 200
		expect(r.lengthMm).toBeGreaterThan(0);
	});

	it('lista vazia não quebra', () => {
		expect(travelOrder([])).toEqual({
			order: [],
			lengthMm: 0,
			twoOpt: false,
			swaps: 0,
		});
	});
});

/* ─────────────────────── Arredondamento ─────────────────────── */

describe('arredondaCents', () => {
	it('nunca arredonda preço para baixo', () => {
		expect(arredondaCents(1234, 'nenhum')).toBe(1234);
		expect(arredondaCents(1234, '0.50')).toBe(1250);
		expect(arredondaCents(1250, '0.50')).toBe(1250);
		expect(arredondaCents(1251, '0.50')).toBe(1300);
		expect(arredondaCents(1234, '1.00')).toBe(1300);
		expect(arredondaCents(1300, '1.00')).toBe(1300);
		expect(arredondaCents(1234, 'psico_9')).toBe(1290);
		expect(arredondaCents(1290, 'psico_9')).toBe(1290);
		expect(arredondaCents(1291, 'psico_9')).toBe(1390);
		expect(arredondaCents(0, 'psico_9')).toBe(0);
	});
});

/* ─────────────────────── Perfis padrão por laser ─────────────────────── */

describe('perfil padrão coerente com o material', () => {
	/**
	 * O padrão do sistema é uma FIBRA de 1500 W. A cascata de velocidade recusa —
	 * com razão — material de CO2 num perfil de fibra, porque MDF não corta em
	 * fibra. Só que MDF é o material mais comum deste público: quem abria a
	 * ferramenta sem perfil e escolhia MDF tomava um erro seco em vez de um
	 * orçamento. O caminho mais provável da primeira visita era o único quebrado.
	 */
	it('CO2 para material de CO2, fibra para o resto', () => {
		expect(defaultProfileFor('co2').laser).toBe('co2');
		expect(defaultProfileFor('fibra').laser).toBe('fibra');
		expect(defaultProfileFor(undefined).laser).toBe('fibra');
	});

	it('o perfil de CO2 é uma máquina de CO2, não uma fibra repintada', () => {
		// Se alguém copiar o perfil de fibra e só trocar o rótulo, o preço sai
		// errado por ordem de grandeza: 1500 W de fonte contra um tubo de 100 W.
		expect(DEFAULT_PROFILE_CO2.potenciaW).toBeLessThan(
			DEFAULT_PROFILE.potenciaW,
		);
		expect(DEFAULT_PROFILE_CO2.energiaKw).toBeLessThan(
			DEFAULT_PROFILE.energiaKw,
		);
		expect(DEFAULT_PROFILE_CO2.valorMaquina).toBeLessThan(
			DEFAULT_PROFILE.valorMaquina,
		);
	});

	it('só a máquina muda — a oficina (overhead, margem, imposto) é a mesma', () => {
		expect(DEFAULT_PROFILE_CO2.overheadPct).toBe(DEFAULT_PROFILE.overheadPct);
		expect(DEFAULT_PROFILE_CO2.margemPct).toBe(DEFAULT_PROFILE.margemPct);
		expect(DEFAULT_PROFILE_CO2.impostoPct).toBe(DEFAULT_PROFILE.impostoPct);
		expect(DEFAULT_PROFILE_CO2.custoHoraOperador).toBe(
			DEFAULT_PROFILE.custoHoraOperador,
		);
	});

	it('o perfil de CO2 resolve velocidade em MDF 3 mm — o caso que quebrava', () => {
		const r = resolveCutSpeed(
			{
				familia: 'mdf',
				espessuraMm: 3,
				laser: DEFAULT_PROFILE_CO2.laser,
				potenciaW: DEFAULT_PROFILE_CO2.potenciaW,
			},
			{ curated: [] },
		);
		expect(r.speedMmS).toBeGreaterThan(0);
		// Sem base curada, é estimativa — e tem que sair MARCADA como tal.
		expect(r.estimativa).toBe(true);
	});

	it('o perfil de FIBRA continua recusando MDF (não afrouxamos a checagem)', () => {
		expect(() =>
			resolveCutSpeed(
				{
					familia: 'mdf',
					espessuraMm: 3,
					laser: 'fibra',
					potenciaW: 1500,
				},
				{ curated: [] },
			),
		).toThrow(/fibra/i);
	});
});

/* ─────────────────────── Perfil ⇄ coleção ─────────────────────── */

describe('perfil como coleção', () => {
	it('round-trip perfil → coleção → perfil não perde nada', () => {
		const data = profileToCollectionData(DEFAULT_PROFILE);
		expect(profileFromCollectionData(data)).toEqual(DEFAULT_PROFILE);
	});

	it('percentual na coleção é 0–100 e no perfil é fração', () => {
		const data = profileToCollectionData(DEFAULT_PROFILE);
		expect(data.overhead_pct).toBe(20);
		expect(data.imposto_pct).toBe(6);
		expect(data.setup_min).toBe(5);
		expect(
			profileFromCollectionData({ overhead_pct: 35 }).overheadPct,
		).toBeCloseTo(0.35, 9);
		expect(profileFromCollectionData({ setup_min: 10 }).setupS).toBe(600);
	});

	it('a spec da coleção cobre todos os campos e traz o padrão', () => {
		const spec = profileFieldsSpec();
		const nomes = spec.map((f) => f.name);
		const data = profileToCollectionData(DEFAULT_PROFILE);
		for (const chave of Object.keys(data)) expect(nomes).toContain(chave);
		expect(nomes).toContain('descontos');
		const overhead = spec.find((f) => f.name === 'overhead_pct');
		expect(overhead?.unit).toBe('%');
		expect(overhead?.placeholder).toBe('20');
	});

	it('recusa valor fora de faixa e enum inválido', () => {
		expect(() => profileFromCollectionData({ margem_pct: 120 })).toThrow(
			/acima do máximo/,
		);
		expect(() => profileFromCollectionData({ laser: 'plasma' })).toThrow(
			/valor inválido/,
		);
		expect(() => profileFromCollectionData({ potencia_w: 'abc' })).toThrow(
			/não numérico/,
		);
	});

	it('faixas de desconto: parse, ordem e faixa aplicável', () => {
		const faixas = parseDescontos('50:10\n10:5\n100:15');
		expect(faixas.map((f) => f.minQtd)).toEqual([10, 50, 100]);
		expect(faixas[0].pct).toBeCloseTo(0.05, 9);
		expect(faixaDesconto(faixas, 9)).toBeUndefined();
		expect(faixaDesconto(faixas, 10)?.pct).toBeCloseTo(0.05, 9);
		expect(faixaDesconto(faixas, 99)?.minQtd).toBe(50);
		expect(faixaDesconto(faixas, 1000)?.minQtd).toBe(100);
		expect(() => parseDescontos('abc')).toThrow(/faixa de desconto inválida/);
		expect(() => parseDescontos('10:120')).toThrow(/zera ou inverte/);
	});
});

/* ─────────────────────── computeQuote ─────────────────────── */

describe('computeQuote', () => {
	it('cobra o material pelo peso da chapa conhecida', () => {
		const q = computeQuote(METRO_QUADRADO, perfil(), {
			qty: 1,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		expect(q.material.pesoKg).toBeCloseTo(7.85, 6);
		const material = q.custos.linhas.find((l) => l.id === 'material');
		expect(material?.cents).toBe(7850); // 7,85 kg × R$ 10,00/kg
	});

	it('cobra por m² quando o material não tem preço por kg', () => {
		const q = computeQuote(METRO_QUADRADO, perfil(), {
			qty: 1,
			material: {
				nome: 'Acrílico 3 mm',
				familia: 'acrílico',
				espessuraMm: 3,
				precoM2: 320,
			},
			speed: VELOCIDADE_FIRME,
		});
		expect(q.material.pesoKg).toBeUndefined();
		expect(q.custos.linhas.find((l) => l.id === 'material')?.cents).toBe(32000);
	});

	it('material sem preço nenhum é erro, não zero', () => {
		expect(() =>
			computeQuote(PLACA, perfil(), {
				qty: 1,
				material: { nome: 'X', familia: 'mdf', espessuraMm: 3 },
				speed: VELOCIDADE_FIRME,
			}),
		).toThrow(/sem preço/);
	});

	it('tempo segue a fórmula: corte, pierce, rápido, gravação e ineficiência', () => {
		const p = perfil({ fatorIneficiencia: 0.15, setupS: 300, vRapidMmS: 500 });
		const metrics: QuoteMetrics = {
			...PLACA,
			engraveAreaMm2: 3000,
			rapidLengthMm: 250,
		};
		const q = computeQuote(metrics, p, {
			qty: 1,
			material: ACO_1MM,
			speed: { ...VELOCIDADE_FIRME, passes: 2 },
		});
		const corte = (metrics.cutLengthMm / 40) * 2;
		const pierce = 2 * 0.55;
		const rapido = 250 / 500;
		const grav = 3000 / (p.vGravMmS * p.lineMm);
		expect(q.tempos.corteS).toBeCloseTo(corte, 3);
		expect(q.tempos.pierceS).toBeCloseTo(pierce, 3);
		expect(q.tempos.rapidS).toBeCloseTo(rapido, 3);
		expect(q.tempos.gravacaoS).toBeCloseTo(grav, 3);
		const bruto = corte + pierce + rapido + grav;
		expect(q.tempos.ineficienciaS).toBeCloseTo(bruto * 0.15, 3);
		expect(q.tempos.unitarioS).toBeCloseTo(bruto * 1.15 + 300, 3);
		expect(q.tempos.loteS).toBeCloseTo(bruto * 1.15 + 300, 3);
	});

	it('mede o deslocamento pelos pontos de entrada quando não vem pronto', () => {
		const q = computeQuote(PLACA, perfil({ vRapidMmS: 500 }), {
			qty: 1,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		// Pontos (0,0) e (40,50); origem = (minX, maxY) = (0,50).
		// (0,50) → (40,50) = 40 mm → (0,0) = hypot(40,50).
		const esperado = (40 + Math.hypot(40, 50)) / 500;
		expect(q.tempos.rapidS).toBeCloseTo(esperado, 3);
	});

	it('a taxa/hora da máquina soma energia, gás, consumíveis, manutenção e depreciação', () => {
		const p = perfil();
		expect(taxaHoraMaquina(p)).toBeCloseTo(
			6 * 0.95 + 3 + 2 + 180000 / 20000,
			9,
		);
		const q = computeQuote(PLACA, p, {
			qty: 1,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		expect(q.maquina.taxaHoraCents).toBe(1970);
	});

	it('markup e margem equivalentes chegam ao MESMO preço', () => {
		const m = 0.35;
		const p = perfil({
			markupPct: m / (1 - m),
			margemPct: m,
			regraArredondamento: 'nenhum',
		});
		const q = computeQuote(PLACA, p, {
			qty: 1,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		expect(q.precos.markup.precoLiquidoCents).toBe(
			q.precos.margem.precoLiquidoCents,
		);
		expect(q.precos.markup.precoUnitCents).toBe(q.precos.margem.precoUnitCents);
		// E a margem efetiva confere com a margem pedida.
		expect(q.precos.margem.margemEfetivaPct).toBeCloseTo(m, 3);
	});

	it('markup e margem de MESMO número são preços diferentes (o erro clássico)', () => {
		const p = perfil({
			markupPct: 0.35,
			margemPct: 0.35,
			regraArredondamento: 'nenhum',
		});
		const q = computeQuote(PLACA, p, {
			qty: 1,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		expect(q.precos.markup.precoUnitCents).toBeLessThan(
			q.precos.margem.precoUnitCents,
		);
		// 35% de markup entrega ~26% de margem: é exatamente o que quebra preço.
		expect(q.precos.markup.margemEfetivaPct).toBeCloseTo(0.35 / 1.35, 2);
	});

	it('imposto entra por gross-up: preço × (1 − imposto) = líquido', () => {
		const p = perfil({ impostoPct: 0.06, regraArredondamento: 'nenhum' });
		const q = computeQuote(PLACA, p, {
			qty: 1,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		const v = q.precos.markup;
		expect(v.precoComImpostoCents * (1 - 0.06)).toBeCloseTo(
			v.precoLiquidoCents,
			0,
		);
		expect(v.impostoCents).toBe(v.precoComImpostoCents - v.precoLiquidoCents);
		// Somar imposto "por fora" daria menos — e a nota cobraria a diferença.
		expect(v.precoComImpostoCents).toBeGreaterThan(
			Math.round(v.precoLiquidoCents * 1.06),
		);
	});

	it('setup é rateado: o custo unitário cai com a quantidade', () => {
		const p = perfil({ setupS: 1800 });
		const um = computeQuote(PLACA, p, {
			qty: 1,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		const dez = computeQuote(PLACA, p, {
			qty: 10,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		expect(um.tempos.setupRateadoS).toBe(1800);
		expect(dez.tempos.setupRateadoS).toBe(180);
		expect(dez.tempos.unitarioS).toBeLessThan(um.tempos.unitarioS);
		expect(dez.custos.totalCents).toBeLessThan(um.custos.totalCents);
		// O lote de 10 paga o setup UMA vez.
		expect(dez.tempos.loteS).toBeCloseTo(
			(um.tempos.loteS - 1800) * 10 + 1800,
			1,
		);
	});

	it('desconto por faixa aplica a faixa certa (maior minQtd ≤ qtd)', () => {
		const p = perfil({ pedidoMinimo: 0 });
		const nove = computeQuote(PLACA, p, {
			qty: 9,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		expect(nove.precos.descontoPct).toBe(0);
		expect(nove.precos.descontoFaixaMinQtd).toBeUndefined();

		const sessenta = computeQuote(PLACA, p, {
			qty: 60,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		expect(sessenta.precos.descontoFaixaMinQtd).toBe(50);
		expect(sessenta.precos.descontoPct).toBeCloseTo(0.1, 9);
		expect(sessenta.precos.descontoCents).toBe(
			Math.round(sessenta.precos.subtotalCents * 0.1),
		);
		expect(sessenta.precos.precoTotalCents).toBe(
			sessenta.precos.subtotalCents - sessenta.precos.descontoCents,
		);
	});

	it('desconto manual vence a faixa', () => {
		const q = computeQuote(PLACA, perfil({ pedidoMinimo: 0 }), {
			qty: 60,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
			descontoPct: 0.02,
		});
		expect(q.precos.descontoPct).toBeCloseTo(0.02, 9);
		expect(q.precos.descontoFaixaMinQtd).toBeUndefined();
	});

	it('preço total nunca fica abaixo do pedido mínimo', () => {
		const p = perfil({ pedidoMinimo: 80 });
		const q = computeQuote(PLACA, p, {
			qty: 1,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		expect(q.precos.precoTotalCents).toBeGreaterThanOrEqual(8000);
		expect(q.precos.aplicouPedidoMinimo).toBe(true);
		expect(q.avisos.join(' ')).toMatch(/pedido mínimo/);

		const muitos = computeQuote(PLACA, p, {
			qty: 200,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		expect(muitos.precos.aplicouPedidoMinimo).toBe(false);
		expect(muitos.precos.precoTotalCents).toBeGreaterThan(8000);
	});

	it('as linhas do custo somam o custo direto, e com overhead somam o total', () => {
		const q = computeQuote(PLACA, perfil({ overheadPct: 0.2 }), {
			qty: 1,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		const soma = q.custos.linhas.reduce((s, l) => s + l.cents, 0);
		expect(soma).toBe(q.custos.diretoCents);
		expect(q.custos.overheadCents).toBe(Math.round(q.custos.diretoCents * 0.2));
		expect(q.custos.diretoCents + q.custos.overheadCents).toBe(
			q.custos.totalCents,
		);
		expect(q.custos.linhas.map((l) => l.id)).toEqual([
			'material',
			'maquina',
			'mao_de_obra',
		]);
	});

	it('acabamento entra como linha própria quando existe', () => {
		const q = computeQuote(PLACA, perfil(), {
			qty: 1,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
			acabamentoPorPeca: 4.5,
		});
		expect(q.custos.linhas.find((l) => l.id === 'acabamento')?.cents).toBe(450);
	});

	it('todo campo de dinheiro da saída é centavo INTEIRO', () => {
		const q = computeQuote(
			{ ...PLACA, engraveAreaMm2: 1234.567 },
			perfil({
				markupPct: 0.7777,
				impostoPct: 0.0891,
				regraArredondamento: 'psico_9',
			}),
			{
				qty: 7,
				material: { ...ACO_1MM, precoKg: 9.37, custoFixoChapa: 13.33 },
				speed: { ...VELOCIDADE_FIRME, speedMmS: 37.3, pierceS: 0.4321 },
			},
		);
		const campos = camposDeDinheiro(q);
		expect(campos.length).toBeGreaterThan(10);
		for (const [caminho, valor] of campos) {
			expect(typeof valor, caminho).toBe('number');
			expect(Number.isInteger(valor), `${caminho} = ${String(valor)}`).toBe(
				true,
			);
		}
	});

	it('propaga a confiança da velocidade e avisa quando é estimativa', () => {
		const estimado = resolveCutSpeed(
			{
				familia: 'aço carbono',
				espessuraMm: 3,
				laser: 'fibra',
				potenciaW: 1500,
			},
			{},
		);
		const q = computeQuote(PLACA, perfil(), {
			qty: 1,
			material: ACO_1MM,
			speed: estimado,
		});
		expect(q.velocidade.source).toBe('modelo');
		expect(q.velocidade.confidence).toBe(0.4);
		expect(q.velocidade.estimativa).toBe(true);
		expect(q.avisos.join(' ')).toMatch(/ESTIMATIVA/);
	});

	it('prazo cresce com o lote e soma o prazo base', () => {
		const p = perfil({ horasUteisDia: 8, prazoBaseDias: 2, setupS: 0 });
		const um = computeQuote(PLACA, p, {
			qty: 1,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		expect(um.prazoDias).toBe(3); // ceil(alguns segundos / 8h) = 1 + 2
		const muitos = computeQuote(PLACA, p, {
			qty: 20000,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		expect(muitos.prazoDias).toBeGreaterThan(um.prazoDias);
	});

	it('quantidade e perfis impossíveis são recusados', () => {
		expect(() =>
			computeQuote(PLACA, perfil(), {
				qty: 0,
				material: ACO_1MM,
				speed: VELOCIDADE_FIRME,
			}),
		).toThrow(/quantidade inválida/);
		expect(() =>
			computeQuote(PLACA, perfil({ margemPct: 1 }), {
				qty: 1,
				material: ACO_1MM,
				speed: VELOCIDADE_FIRME,
			}),
		).toThrow(/margem de 100%/);
		expect(() =>
			computeQuote(PLACA, perfil({ impostoPct: 1 }), {
				qty: 1,
				material: ACO_1MM,
				speed: VELOCIDADE_FIRME,
			}),
		).toThrow(/imposto de 100%/);
	});

	it('mesmas entradas → mesma saída (função pura)', () => {
		const args = [
			PLACA,
			perfil(),
			{ qty: 3, material: ACO_1MM, speed: VELOCIDADE_FIRME },
		] as const;
		expect(computeQuote(...args)).toEqual(computeQuote(...args));
	});
});

/* ───────────────── Regressões da revisão adversarial ───────────────── */

describe('regressões: dinheiro', () => {
	it('descontos em branco NÃO herdam as faixas do sistema', () => {
		// O campo `descontos` é o único do perfil sem `required`, e o que a tela
		// mostra é PLACEHOLDER. Deixar em branco é "não dou desconto", e herdar
		// 5/10/15% do DEFAULT_PROFILE dava desconto que ninguém cadastrou.
		const semChave = profileFromCollectionData({ laser: 'co2' });
		expect(semChave.descontos).toEqual([]);

		const vazio = profileFromCollectionData({ laser: 'co2', descontos: '   ' });
		expect(vazio.descontos).toEqual([]);

		// E o round-trip não pode gravar as faixas do sistema no perfil dele.
		expect(profileToCollectionData(semChave).descontos).toBe('');

		// Quem preenche continua sendo respeitado.
		const cheio = profileFromCollectionData({ descontos: '50:10' });
		expect(cheio.descontos).toEqual([{ minQtd: 50, pct: 0.1 }]);
	});

	it('perfil sem faixas não aplica desconto nenhum no pedido', () => {
		const b = computeQuote(PLACA, profileFromCollectionData({}), {
			qty: 200,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		expect(b.precos.descontoPct).toBe(0);
		expect(b.precos.descontoCents).toBe(0);
		expect(b.precos.subtotalCents).toBe(b.precos.precoUnitCents * 200);
	});

	it('prazo conta o trabalho MANUAL, não só a máquina', () => {
		const args = {
			qty: 1000,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		} as const;
		const semManual = computeQuote(PLACA, perfil(), {
			...args,
			tempoManualMin: 0,
		});
		// 30 min por peça × 1000 peças = 500 h de trabalho fora da máquina.
		const comManual = computeQuote(PLACA, perfil(), {
			...args,
			tempoManualMin: 30,
		});

		expect(comManual.tempos.manualS).toBe(30 * 60 * 1000);
		expect(comManual.tempos.loteComManualS).toBeCloseTo(
			comManual.tempos.loteS + comManual.tempos.manualS,
			3,
		);
		// `loteS` continua sendo só máquina — os dois têm o mesmo tempo de corte.
		expect(comManual.tempos.loteS).toBeCloseTo(semManual.tempos.loteS, 3);
		// …mas o prazo TEM que crescer: 500 h a 8 h/dia são 63 dias úteis.
		expect(comManual.prazoDias).toBeGreaterThan(semManual.prazoDias + 60);
		// E o custo de mão de obra já cobrava por essas horas.
		const mo = (b: typeof comManual) =>
			b.custos.linhas.find((l) => l.id === 'mao_de_obra')?.cents ?? 0;
		expect(mo(comManual)).toBeGreaterThan(mo(semManual));
	});

	it('arredondamento que infla o unitário vira AVISO', () => {
		const barata: QuoteMetrics = {
			cutLengthMm: 120,
			pierces: 1,
			netAreaMm2: 900,
			bboxAreaMm2: 900,
			bbox: { w: 30, h: 30 },
		};
		const base = { qty: 1000, material: ACO_1MM, speed: VELOCIDADE_FIRME };

		const semRegra = computeQuote(
			barata,
			perfil({ regraArredondamento: 'nenhum', pedidoMinimo: 0, descontos: [] }),
			base,
		);
		expect(semRegra.avisos.filter((a) => /arredondamento/.test(a))).toEqual([]);

		const comRegra = computeQuote(
			barata,
			perfil({ regraArredondamento: '1.00', pedidoMinimo: 0, descontos: [] }),
			base,
		);
		// O preço arredondado continua sendo o que a regra manda…
		expect(comRegra.precos.precoUnitCents % 100).toBe(0);
		// …mas agora o profissional é avisado de que o degrau, não o custo, é quem
		// está definindo o pedido inteiro.
		expect(comRegra.avisos.some((a) => /arredondamento/.test(a))).toBe(true);
	});

	it('margem efetiva do PEDIDO considera desconto e pedido mínimo', () => {
		const b = computeQuote(
			PLACA,
			perfil({ descontos: [{ minQtd: 100, pct: 0.15 }], pedidoMinimo: 0 }),
			{ qty: 200, material: ACO_1MM, speed: VELOCIDADE_FIRME },
		);
		expect(b.precos.descontoPct).toBe(0.15);
		// A margem pré-desconto (a que já existia) é otimista demais.
		expect(b.precos.margemEfetivaComDescontoPct).toBeLessThan(
			b.precos.markup.margemEfetivaPct,
		);
		// E bate com a conta feita à mão sobre o total realmente cobrado.
		const liquido =
			(b.precos.precoTotalCents / b.qty) * (1 - b.precos.impostoPct);
		expect(b.precos.margemEfetivaComDescontoPct).toBeCloseTo(
			(liquido - b.custos.totalCents) / liquido,
			6,
		);
	});

	it('unitário efetivo fecha com o total quando o pedido mínimo entra', () => {
		const b = computeQuote(PLACA, perfil({ pedidoMinimo: 500 }), {
			qty: 2,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
		});
		expect(b.precos.aplicouPedidoMinimo).toBe(true);
		expect(b.precos.precoUnitEfetivoCents * b.qty).toBeGreaterThanOrEqual(
			b.precos.precoTotalCents,
		);
		// Sem pedido mínimo nem desconto, o efetivo é o próprio preço de tabela.
		const normal = computeQuote(
			PLACA,
			perfil({ pedidoMinimo: 0, descontos: [] }),
			{ qty: 10, material: ACO_1MM, speed: VELOCIDADE_FIRME },
		);
		expect(normal.precos.precoUnitEfetivoCents).toBe(
			normal.precos.precoUnitCents,
		);
	});
});

/* ───────────── O pedido fecha? (a conta que faltava falar) ───────────── */

describe('avisos de dinheiro', () => {
	/**
	 * O perfil que o profissional monta sozinho e que quebra o preço dele: 35%
	 * "de margem" digitados no campo de MARKUP, imposto do Simples e uma faixa de
	 * 30% de desconto acima de 100 peças. Cada número é plausível; juntos, dão
	 * prejuízo — e a ferramenta fechava esse pedido sem dizer nada.
	 */
	const CONFUSO = () =>
		perfil({
			markupPct: 0.35,
			impostoPct: 0.06,
			descontos: [{ minQtd: 100, pct: 0.3 }],
			pedidoMinimo: 0,
			regraArredondamento: 'nenhum',
			overheadPct: 0.2,
		});

	const orca = (p: QuoteProfile, qty: number, over = {}) =>
		computeQuote(PLACA, p, {
			qty,
			material: ACO_1MM,
			speed: VELOCIDADE_FIRME,
			...over,
		});

	it('preço abaixo do custo vira ERRO, com o prejuízo em reais', () => {
		const q = orca(CONFUSO(), 100);
		// (1 + 0,35) ÷ (1 − 0,06) × (1 − 0,30) × (1 − 0,06) = 0,945 × custo.
		expect(q.precos.lucroPedidoCents).toBeLessThan(0);

		const erro = q.alertas.find((a) => a.codigo === 'preco_abaixo_do_custo');
		expect(erro?.severidade).toBe('erro');
		// A frase tem que trazer O NÚMERO que a causou — os três.
		expect(erro?.mensagem).toContain(brl(-q.precos.lucroPedidoCents));
		expect(erro?.mensagem).toContain(brl(q.precos.custoLoteCents));
		expect(erro?.mensagem).toContain('30%');
		// E aponta o culpado: sem o desconto, este pedido daria lucro.
		expect(erro?.mensagem).toMatch(/desconto/i);
	});

	it('o teto de desconto do aviso é o teto de verdade', () => {
		const p = CONFUSO();
		const semDesconto = orca(p, 100, { descontoPct: 0 });
		const teto = semDesconto.precos.descontoMaximoPct;
		expect(teto).toBeGreaterThan(0);
		expect(teto).toBeLessThan(0.3);

		// Dando exatamente o teto, o pedido ainda paga o custo…
		const noTeto = orca(p, 100, { descontoPct: teto });
		expect(noTeto.precos.lucroPedidoCents).toBeGreaterThanOrEqual(0);
		expect(
			noTeto.alertas.some((a) => a.codigo === 'preco_abaixo_do_custo'),
		).toBe(false);

		// …e um ponto percentual além dele, não paga mais.
		const acima = orca(p, 100, { descontoPct: teto + 0.01 });
		expect(acima.precos.lucroPedidoCents).toBeLessThan(0);
	});

	it('desconto negociado de 60% não passa em silêncio', () => {
		const q = orca(perfil({ pedidoMinimo: 0, descontos: [] }), 100, {
			descontoPct: 0.6,
		});
		const erro = q.alertas.find((a) => a.codigo === 'preco_abaixo_do_custo');
		expect(erro).toBeDefined();
		expect(erro?.mensagem).toContain(pctBR(q.precos.descontoMaximoPct, 1));
	});

	it('desconto que só MORDE a margem avisa quantos pontos comeu', () => {
		const q = orca(
			perfil({
				markupPct: 1,
				margemPct: 0.5,
				precificarPor: 'markup',
				impostoPct: 0.06,
				descontos: [{ minQtd: 100, pct: 0.15 }],
				pedidoMinimo: 0,
				regraArredondamento: 'nenhum',
			}),
			200,
		);
		// Continua dando lucro — não é caso de erro, é caso de "olha aqui".
		expect(q.precos.lucroPedidoCents).toBeGreaterThan(0);
		const a = q.alertas.find((x) => x.codigo === 'margem_abaixo_da_pedida');
		expect(a?.severidade).toBe('aviso');
		expect(a?.mensagem).toMatch(/pontos/);
		expect(a?.mensagem).toContain(brl(q.precos.lucroPedidoCents));
		expect(a?.mensagem).toContain('15%');
	});

	it('markup e margem NÃO são confundidos ao conferir a margem pedida', () => {
		// Fechando por markup de 35%, a margem pedida é 25,9% — e é com ela que a
		// margem efetiva tem que ser comparada. Comparar 35% de markup com 35% de
		// margem geraria alarme em todo orçamento saudável do produto.
		const q = orca(
			perfil({
				markupPct: 0.35,
				margemPct: 0.35,
				precificarPor: 'markup',
				descontos: [],
				pedidoMinimo: 0,
				regraArredondamento: 'nenhum',
			}),
			10,
		);
		expect(q.precos.lucroPedidoCents).toBeGreaterThan(0);
		expect(
			q.alertas.filter((a) => a.codigo === 'margem_abaixo_da_pedida'),
		).toEqual([]);
	});

	it('pedido saudável não inventa alerta nenhum de dinheiro', () => {
		const q = orca(
			perfil({ descontos: [], pedidoMinimo: 0, regraArredondamento: 'nenhum' }),
			10,
		);
		expect(q.precos.lucroPedidoCents).toBeGreaterThan(0);
		expect(q.alertas.filter((a) => a.severidade === 'erro')).toEqual([]);
	});

	it('o lucro do pedido é o líquido menos o custo, e fecha com a margem', () => {
		const q = orca(perfil({ pedidoMinimo: 0, descontos: [] }), 25);
		expect(q.precos.custoLoteCents).toBe(q.custos.totalCents * q.qty);
		expect(q.precos.liquidoPedidoCents).toBe(
			Math.round(q.precos.precoTotalCents * (1 - q.precos.impostoPct)),
		);
		expect(q.precos.lucroPedidoCents).toBe(
			q.precos.liquidoPedidoCents - q.precos.custoLoteCents,
		);
		// O percentual que já existia e o dinheiro novo têm que ter o mesmo sinal.
		expect(q.precos.margemEfetivaComDescontoPct > 0).toBe(
			q.precos.lucroPedidoCents > 0,
		);
	});

	it('o piso é o menor preço que ainda paga o custo — com o desconto do pedido', () => {
		const comDesconto = orca(perfil({ pedidoMinimo: 0, descontos: [] }), 50, {
			descontoPct: 0.2,
		});
		const sem = orca(perfil({ pedidoMinimo: 0, descontos: [] }), 50);
		// Com 20% de desconto na mesa, a tabela precisa ser mais alta para o
		// pedido empatar: o piso É outro, e era isso que faltava dizer.
		expect(comDesconto.precos.precoUnitMinimoCents).toBeGreaterThan(
			sem.precos.precoUnitMinimoCents,
		);
		// E o piso sem desconto é o custo com o imposto por cima, arredondado
		// para cima (nunca um centavo abaixo do empate).
		expect(sem.precos.precoUnitMinimoCents).toBe(
			Math.ceil(sem.custos.totalCents / (1 - sem.precos.impostoPct)),
		);
	});

	it('custo de material que não chega a um centavo é dito, não engolido', () => {
		// EVA 2 mm, peça de 10×10 mm: R$ 0,0012 de material por peça. A linha
		// arredonda para R$ 0,00 — mas em 500 peças são R$ 0,60 fora do preço.
		const miuda: QuoteMetrics = {
			cutLengthMm: 40,
			pierces: 1,
			netAreaMm2: 100,
			bboxAreaMm2: 100,
			bbox: { w: 10, h: 10 },
		};
		const q = computeQuote(miuda, perfil({ pedidoMinimo: 0, descontos: [] }), {
			qty: 500,
			material: {
				nome: 'EVA 2 mm',
				familia: 'eva',
				espessuraMm: 2,
				precoKg: 60,
			},
			speed: VELOCIDADE_FIRME,
		});
		expect(q.custos.linhas.find((l) => l.id === 'material')?.cents).toBe(0);
		const a = q.alertas.find((x) => x.codigo === 'custo_abaixo_do_centavo');
		expect(a?.mensagem).toMatch(/Material/);
		expect(a?.mensagem).toMatch(/500 peças/);
	});

	it('a cobrança por chapa avisa que a sobra está no preço', () => {
		const q = computeQuote(
			PLACA,
			perfil({ materialBasis: 'chapa', pedidoMinimo: 0, descontos: [] }),
			{ qty: 1, material: ACO_1MM, speed: VELOCIDADE_FIRME },
		);
		expect(q.material.chapas).toBe(1);
		expect(q.material.sobraPecas).toBe(161);
		expect(q.alertas.some((a) => a.codigo === 'material')).toBe(true);
		expect(q.avisos.join(' ')).toMatch(/sobra/);
	});

	it('o lote que abre a segunda chapa paga a segunda chapa', () => {
		const material = { ...ACO_1MM, basis: 'chapa' as const };
		const p = perfil({ pedidoMinimo: 0, descontos: [] });
		const materialDoLote = (qty: number) => {
			const q = computeQuote(PLACA, p, {
				qty,
				material,
				speed: VELOCIDADE_FIRME,
			});
			return (
				(q.custos.linhas.find((l) => l.id === 'material')?.cents ?? 0) * qty
			);
		};
		// Chapa 2000×1000 de aço 1 mm: 2 m² × 7,85 kg/m² × R$ 10 = R$ 157,00.
		const CHAPA_CENTS = 15_700;
		expect(Math.abs(materialDoLote(162) - CHAPA_CENTS)).toBeLessThanOrEqual(
			162,
		);
		expect(Math.abs(materialDoLote(163) - 2 * CHAPA_CENTS)).toBeLessThanOrEqual(
			163,
		);
	});

	it('`avisos` é sempre a projeção de `alertas` — nunca uma segunda lista', () => {
		const q = orca(CONFUSO(), 100);
		expect(q.avisos).toEqual(q.alertas.map((a) => a.mensagem));
		expect(q.alertas.every((a) => a.codigo && a.titulo && a.mensagem)).toBe(
			true,
		);

		prefixaAlertas(q, [
			{
				codigo: 'teste',
				severidade: 'info',
				titulo: 'Teste',
				mensagem: 'primeiro de todos',
			},
		]);
		expect(q.avisos[0]).toBe('primeiro de todos');
		expect(q.avisos).toEqual(q.alertas.map((a) => a.mensagem));
	});

	it('todo aviso de dinheiro traz pelo menos um número dentro', () => {
		const q = orca(CONFUSO(), 100);
		const deDinheiro = q.alertas.filter((a) =>
			[
				'preco_abaixo_do_custo',
				'preco_no_custo',
				'margem_abaixo_da_pedida',
			].includes(a.codigo),
		);
		expect(deDinheiro.length).toBeGreaterThan(0);
		for (const a of deDinheiro) {
			expect(a.mensagem, a.codigo).toMatch(/R\$ \d/);
			// Frase de gente: começa em minúscula depois do título e termina em ponto.
			expect(a.mensagem.trim().endsWith('.'), a.codigo).toBe(true);
		}
	});
});
