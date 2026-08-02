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
	faixaDesconto,
	parseDescontos,
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

		const chapa = areaCobradaMm2(m, { ...ACO_1MM, basis: 'chapa' });
		// 2000×1000, margem 10 → útil 1980×980; peça 100 + gap 5 → 18 × 9 = 162
		expect(chapa.pecasPorChapa).toBe(162);
		expect(chapa.areaMm2).toBeCloseTo(2_000_000 / 162, 6);
		expect(chapa.areaMm2).toBeGreaterThan(bbox.areaMm2);
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
