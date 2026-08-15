/**
 * MATERIAIS — densidade, peso e a ÁREA QUE SE COBRA do cliente.
 *
 * Módulo PURO (só built-ins + `tool-errors`). Nada de env, nada de I/O: o
 * catálogo de verdade mora na coleção `materiais` da Fábrica; aqui ficam só a
 * física (densidade → peso) e as três políticas de área cobrada. `seedMateriaisCsv`
 * existe para semear essa coleção pelo import de CSV, sem DDL nem tabela nova.
 *
 * A regra que vale para todo este diretório: nenhum número sai de LLM. Peso,
 * área e quantidade de peças por chapa são determinísticos e testáveis.
 */

import { ToolEngineError } from '../tool-errors.js';

/* ─────────────────────────── Densidades ─────────────────────────── */

/**
 * Densidade em g/cm³ pelos nomes como o profissional fala. A busca é feita por
 * `densidadeDe()`, que normaliza acento/caixa/separador — a chave aqui é a
 * grafia PT-BR de exibição, não um slug.
 */
export const DENSIDADES: Record<string, number> = {
	'aço carbono': 7.85,
	'inox 304': 7.93,
	'inox 430': 7.7,
	alumínio: 2.7,
	latão: 8.4,
	cobre: 8.96,
	titânio: 4.51,
	zinco: 7.14,
	galvanizado: 7.85,
	mdf: 0.75,
	'mdf cru': 0.72,
	compensado: 0.6,
	acrílico: 1.19,
	policarbonato: 1.2,
	pvc: 1.4,
	abs: 1.04,
	couro: 0.9,
	eva: 0.1,
	papelão: 0.7,
	borracha: 1.5,
};

/**
 * Apelidos que aparecem em arquivo de cliente e em base de aluno. Sem isto,
 * "Aço 1020" ou "Acrilico" cairiam no erro de material desconhecido e o
 * orçamento pararia por causa de um acento.
 */
const APELIDOS: Record<string, string> = {
	aco: 'aço carbono',
	'aco 1020': 'aço carbono',
	'aco carbono': 'aço carbono',
	'aco doce': 'aço carbono',
	'sae 1020': 'aço carbono',
	inox: 'inox 304',
	'aco inox': 'inox 304',
	'inox 316': 'inox 304', // densidade ~7,98: a diferença de 0,6% não move preço
	al: 'alumínio',
	aluminio: 'alumínio',
	latao: 'latão',
	bronze: 'latão', // 8,4–8,9 g/cm³; usa latão até existir linha própria
	titanio: 'titânio',
	'chapa galvanizada': 'galvanizado',
	'aco galvanizado': 'galvanizado',
	'mdf branco': 'mdf',
	'mdf pintado': 'mdf',
	acrilico: 'acrílico',
	pmma: 'acrílico',
	acrylic: 'acrílico',
	pc: 'policarbonato',
	papelao: 'papelão',
	'papel cartao': 'papelão',
	'papel cartão': 'papelão',
	mdp: 'mdf',
	'compensado naval': 'compensado',
};

/** Normaliza para comparação: sem acento, minúsculo, separadores colapsados. */
export function normalizeMaterialKey(nome: string): string {
	return nome
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[_\-/]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

const INDICE_DENSIDADE: Record<string, number> = (() => {
	const idx: Record<string, number> = {};
	for (const [nome, d] of Object.entries(DENSIDADES)) {
		idx[normalizeMaterialKey(nome)] = d;
	}
	for (const [apelido, alvo] of Object.entries(APELIDOS)) {
		const d = DENSIDADES[alvo];
		if (d !== undefined) idx[normalizeMaterialKey(apelido)] = d;
	}
	return idx;
})();

/** Densidade em g/cm³, ou `undefined` se o material não é conhecido. */
export function densidadeDe(nome: string | undefined): number | undefined {
	if (!nome) return undefined;
	const k = normalizeMaterialKey(nome);
	if (INDICE_DENSIDADE[k] !== undefined) return INDICE_DENSIDADE[k];
	// "Inox 304 escovado", "MDF 15mm branco": casa pelo prefixo mais longo,
	// que é o mais específico ("inox 304" vence "inox").
	let melhor: number | undefined;
	let melhorLen = 0;
	for (const [chave, d] of Object.entries(INDICE_DENSIDADE)) {
		if (
			chave.length > melhorLen &&
			(k.startsWith(`${chave} `) || k === chave)
		) {
			melhor = d;
			melhorLen = chave.length;
		}
	}
	return melhor;
}

/* ─────────────────────────── Peso ─────────────────────────── */

/**
 * peso_kg = area_mm2 · espessura_mm · densidade_g_cm3 / 1e6
 *
 * De onde vem o 1e6: mm² · mm = mm³, e 1 cm³ = 1000 mm³, então
 * (mm³/1000)·(g/cm³) = g, e g/1000 = kg → divide por 1e6 no total.
 * Conferência: 1000×1000×1 mm de aço = 1e6·1·7,85/1e6 = 7,85 kg. ✔
 */
export function pesoKg(
	areaMm2: number,
	espessuraMm: number,
	densidadeGcm3: number,
): number {
	return (areaMm2 * espessuraMm * densidadeGcm3) / 1e6;
}

/* ─────────────────── Peças por chapa (grid ingênuo) ─────────────────── */

/** Margem de borda da chapa (mm) que a máquina não alcança/não se corta. */
export const MARGEM_CHAPA_MM = 10;
/** Vão entre peças (mm) — separa cortes e evita zona termicamente afetada. */
export const GAP_PECAS_MM = 5;
/** Aproveitamento padrão de chapa quando se cobra pela área líquida. */
export const APROVEITAMENTO_PADRAO = 0.75;

export interface GridFitOpts {
	margemMm?: number;
	gapMm?: number;
	/** `false` proíbe girar a peça (veio de madeira, escovado do inox). */
	permitirRotacao?: boolean;
}

/**
 * Quantas peças `w×h` cabem numa chapa `chapaW×chapaH` por GRID: fileiras e
 * colunas alinhadas, melhor das duas orientações.
 *
 * Por que NÃO fazemos nesting irregular aqui: encaixe ótimo de polígonos é
 * NP-difícil, e um resultado que muda a cada execução (ou que leva segundos)
 * não serve para precificar — o profissional precisa poder CONFERIR a conta.
 * O grid acerta a contagem em ~90% dos casos reais de laser (peças
 * retangularizadas, chapa padrão) e erra sempre para o lado seguro: subestima o
 * aproveitamento, nunca cobra menos material do que o necessário. Quem quer
 * ganhar os últimos % usa o nesting do `lib/cad/nest.ts` no arquivo final.
 */
export function pecasPorChapa(
	pecaWmm: number,
	pecaHmm: number,
	chapaWmm: number,
	chapaHmm: number,
	opts: GridFitOpts = {},
): number {
	const margem = opts.margemMm ?? MARGEM_CHAPA_MM;
	const gap = opts.gapMm ?? GAP_PECAS_MM;
	const utilW = chapaWmm - 2 * margem;
	const utilH = chapaHmm - 2 * margem;
	if (!(pecaWmm > 0 && pecaHmm > 0) || utilW <= 0 || utilH <= 0) return 0;

	// +gap nos dois lados: N peças têm N-1 vãos, então (util + gap) / (peça + gap).
	const conta = (w: number, h: number) =>
		Math.floor((utilW + gap) / (w + gap)) *
		Math.floor((utilH + gap) / (h + gap));

	const reto = conta(pecaWmm, pecaHmm);
	const girado = opts.permitirRotacao === false ? 0 : conta(pecaHmm, pecaWmm);
	return Math.max(reto, girado);
}

/* ─────────────────── Área cobrada ─────────────────── */

/**
 * Política de cobrança do material:
 * - `liquido`: área da peça (furos descontados) ÷ aproveitamento. Bom para quem
 *   corta muita peça pequena e reaproveita a sobra de verdade.
 * - `bbox`: área do retângulo envolvente. É o mais honesto para chapa: o retalho
 *   em volta do contorno raramente vira outra peça, e quem paga por ele é você.
 * - `chapa`: as chapas INTEIRAS que o pedido consome (`ceil(qtd / peças por
 *   chapa)`), rateadas pelas peças pedidas. Para quem compra chapa por pedido e
 *   não guarda sobra: a sobra da última chapa é dele, então está no preço.
 */
export type MaterialBasis = 'liquido' | 'bbox' | 'chapa';

export interface MaterialInput {
	/** Nome como aparece no orçamento ("Inox 304 1,2mm"). */
	nome: string;
	/** Família para densidade/curva de velocidade ("inox 304"). Cai em `nome`. */
	familia?: string;
	espessuraMm: number;
	/** g/cm³. Ausente = resolvido por `densidadeDe(familia ?? nome)`. */
	densidade?: number;
	/** R$/kg (metal, madeira). Use um dos dois preços. */
	precoKg?: number;
	/** R$/m² (chapa vendida por área: acrílico, EVA, papelão). */
	precoM2?: number;
	/** R$ fixos por chapa comprada (frete, corte no fornecedor). */
	custoFixoChapa?: number;
	chapaWmm?: number;
	chapaHmm?: number;
	/** 0..1 — quanto da chapa vira peça, no critério `liquido`. */
	aproveitamento?: number;
	basis?: MaterialBasis;
	permitirRotacao?: boolean;
}

export interface AreaCobradaInput {
	/** Área da peça com furos JÁ descontados (mm²). */
	netAreaMm2: number;
	/** Área do retângulo envolvente (mm²). */
	bboxAreaMm2: number;
	bbox: { w: number; h: number };
}

export interface AreaCobradaResult {
	basis: MaterialBasis;
	/** Área cobrada de UMA peça (mm²). */
	areaMm2: number;
	/** Só em `basis: 'chapa'`: quantas peças o grid põe na chapa. */
	pecasPorChapa?: number;
	/** Só em `basis: 'chapa'`: quantas chapas o pedido inteiro consome. */
	chapas?: number;
	/** Só em `basis: 'chapa'`: capacidade comprada e não usada, em peças. */
	sobraPecas?: number;
	aproveitamento?: number;
	avisos: string[];
}

export interface AreaCobradaOpts {
	/** Quantidade do PEDIDO. Decide quantas chapas ele consome de verdade. */
	qty?: number;
}

/** Área que entra na conta de material, segundo a política escolhida. */
export function areaCobradaMm2(
	metrics: AreaCobradaInput,
	material: MaterialInput,
	opts: AreaCobradaOpts = {},
): AreaCobradaResult {
	const basis = material.basis ?? 'bbox';
	const avisos: string[] = [];
	const qty = Math.max(1, Math.floor(opts.qty ?? 1));

	if (basis === 'liquido') {
		const aprov = material.aproveitamento ?? APROVEITAMENTO_PADRAO;
		if (!(aprov > 0 && aprov <= 1)) {
			throw new ToolEngineError(
				400,
				`aproveitamento de chapa deve estar entre 0 e 1 (recebi ${aprov})`,
			);
		}
		return {
			basis,
			areaMm2: metrics.netAreaMm2 / aprov,
			aproveitamento: aprov,
			avisos,
		};
	}

	if (basis === 'bbox') return { basis, areaMm2: metrics.bboxAreaMm2, avisos };

	// basis === 'chapa'
	const { chapaWmm, chapaHmm } = material;
	if (!chapaWmm || !chapaHmm) {
		throw new ToolEngineError(
			400,
			'cobrança por chapa exige as medidas da chapa (chapa_w_mm e chapa_h_mm) no material',
		);
	}
	const n = pecasPorChapa(metrics.bbox.w, metrics.bbox.h, chapaWmm, chapaHmm, {
		permitirRotacao: material.permitirRotacao,
	});
	if (n < 1) {
		throw new ToolEngineError(
			400,
			`a peça (${metrics.bbox.w.toFixed(1)}×${metrics.bbox.h.toFixed(1)} mm) não cabe na chapa (${chapaWmm}×${chapaHmm} mm)`,
		);
	}

	// AQUI ESTAVA UM BURACO DE DINHEIRO MEDIDO: a conta era `chapa / n`,
	// INDEPENDENTE da quantidade pedida. Só que `basis: 'chapa'` significa "eu
	// compro a chapa por pedido e não guardo sobra" — quem pede 1 peça compra 1
	// chapa inteira, e quem pede 28 (com 27 por chapa) compra DUAS. Na fórmula
	// antiga, um pedido de 28 peças cobrava 1,04 chapa e o profissional pagava as
	// outras 0,96 do próprio bolso (R$ 696 num inox 2000×1000).
	//
	// A conta certa é a da nota fiscal do fornecedor: chapas inteiras.
	//   chapas       = ceil(qty / peças_por_chapa)
	//   área/peça    = chapas × área_da_chapa / qty
	// Com qty = 1 isso devolve a chapa INTEIRA, que é o que ele compra mesmo —
	// e é por isso que a sobra vira AVISO em vez de sumir dentro do preço.
	const chapas = Math.ceil(qty / n);
	const sobraPecas = chapas * n - qty;
	if (n === 1) {
		avisos.push(
			`só 1 peça cabe na chapa de ${chapaWmm}×${chapaHmm} mm: cada peça deste pedido leva uma chapa inteira`,
		);
	} else if (sobraPecas > 0) {
		avisos.push(
			`cobrança por chapa: ${qty} ${qty === 1 ? 'peça consome' : 'peças consomem'} ${chapas} ${chapas === 1 ? 'chapa' : 'chapas'} de ${chapaWmm}×${chapaHmm} mm (cabem ${n} por chapa) — a sobra, que daria mais ${sobraPecas} ${sobraPecas === 1 ? 'peça' : 'peças'}, está no preço. É isso que "cobrar por chapa" quer dizer; para não cobrar a sobra, use a cobrança por peça.`,
		);
	}
	return {
		basis,
		areaMm2: (chapaWmm * chapaHmm * chapas) / qty,
		pecasPorChapa: n,
		chapas,
		sobraPecas,
		avisos,
	};
}

/* ─────────────────── Seed da coleção `materiais` ─────────────────── */

interface SeedRow {
	title: string;
	familia: string;
	precoKg: number;
	chapaW: number;
	chapaH: number;
	/** Espessuras comerciais, separadas por `|` (a vírgula é do CSV). */
	espessuras: string;
	/** Que laser corta: `fibra`, `co2`, `fibra|co2` ou `nao`. */
	laser: string;
}

/**
 * Base inicial de materiais. Preços são REFERÊNCIA (R$/kg, praça sudeste) para
 * a tela não abrir vazia — o profissional troca pelo preço da NOTA dele, que é
 * o único que vale. Chapa 0×0 = não vem em chapa (couro é por peça/pele).
 */
const SEED: SeedRow[] = [
	// Metais — fibra
	{
		title: 'Aço carbono',
		familia: 'aço carbono',
		precoKg: 9.5,
		chapaW: 2000,
		chapaH: 1000,
		espessuras: '0.9|1.2|1.5|2|3|4|5|6|8|10',
		laser: 'fibra',
	},
	{
		title: 'Aço galvanizado',
		familia: 'galvanizado',
		precoKg: 11,
		chapaW: 2000,
		chapaH: 1000,
		espessuras: '0.5|0.75|0.9|1.2|1.5|2',
		laser: 'fibra',
	},
	{
		title: 'Inox 304',
		familia: 'inox 304',
		precoKg: 38,
		chapaW: 2000,
		chapaH: 1000,
		espessuras: '0.5|0.8|1|1.2|1.5|2|3|4|5|6',
		laser: 'fibra',
	},
	{
		title: 'Inox 430',
		familia: 'inox 430',
		precoKg: 26,
		chapaW: 2000,
		chapaH: 1000,
		espessuras: '0.5|0.8|1|1.2|1.5|2',
		laser: 'fibra',
	},
	{
		title: 'Alumínio',
		familia: 'alumínio',
		precoKg: 32,
		chapaW: 2000,
		chapaH: 1000,
		espessuras: '0.8|1|1.2|1.5|2|3|4|5|6',
		laser: 'fibra',
	},
	{
		title: 'Latão',
		familia: 'latão',
		precoKg: 55,
		chapaW: 1000,
		chapaH: 1000,
		espessuras: '0.5|0.8|1|1.5|2|3',
		laser: 'fibra',
	},
	{
		title: 'Cobre',
		familia: 'cobre',
		precoKg: 65,
		chapaW: 1000,
		chapaH: 1000,
		espessuras: '0.5|0.8|1|1.5|2|3',
		laser: 'fibra',
	},
	{
		title: 'Titânio',
		familia: 'titânio',
		precoKg: 420,
		chapaW: 1000,
		chapaH: 1000,
		espessuras: '0.5|1|1.5|2|3',
		laser: 'fibra',
	},
	{
		title: 'Zinco',
		familia: 'zinco',
		precoKg: 30,
		chapaW: 1000,
		chapaH: 1000,
		espessuras: '0.5|0.8|1|1.5',
		laser: 'fibra',
	},
	// Madeira e derivados — CO2
	{
		title: 'MDF',
		familia: 'mdf',
		precoKg: 8,
		chapaW: 2750,
		chapaH: 1830,
		espessuras: '3|6|9|12|15|18',
		laser: 'co2',
	},
	{
		title: 'MDF cru',
		familia: 'mdf cru',
		precoKg: 7,
		chapaW: 2750,
		chapaH: 1830,
		espessuras: '3|6|9|12|15|18',
		laser: 'co2',
	},
	{
		title: 'Compensado',
		familia: 'compensado',
		precoKg: 12,
		chapaW: 2200,
		chapaH: 1600,
		espessuras: '3|4|6|10|15',
		laser: 'co2',
	},
	// Plásticos e outros — CO2
	{
		title: 'Acrílico',
		familia: 'acrílico',
		precoKg: 45,
		chapaW: 2000,
		chapaH: 1000,
		espessuras: '2|3|4|5|6|8|10',
		laser: 'co2',
	},
	{
		title: 'Policarbonato',
		familia: 'policarbonato',
		precoKg: 55,
		chapaW: 2000,
		chapaH: 1000,
		espessuras: '2|3|4|6',
		laser: 'nao',
	},
	{
		title: 'PVC',
		familia: 'pvc',
		precoKg: 25,
		chapaW: 2000,
		chapaH: 1000,
		espessuras: '1|2|3|5',
		laser: 'nao',
	},
	{
		title: 'ABS',
		familia: 'abs',
		precoKg: 35,
		chapaW: 2000,
		chapaH: 1000,
		espessuras: '1|2|3|5',
		laser: 'nao',
	},
	{
		title: 'Couro',
		familia: 'couro',
		precoKg: 180,
		chapaW: 0,
		chapaH: 0,
		espessuras: '1|1.5|2|2.5|3',
		laser: 'co2',
	},
	{
		title: 'EVA',
		familia: 'eva',
		precoKg: 60,
		chapaW: 1000,
		chapaH: 1000,
		espessuras: '2|3|5|10',
		laser: 'co2',
	},
	{
		title: 'Papelão',
		familia: 'papelão',
		precoKg: 6,
		chapaW: 1000,
		chapaH: 1000,
		espessuras: '1|2|3|5',
		laser: 'co2',
	},
	{
		title: 'Borracha',
		familia: 'borracha',
		precoKg: 22,
		chapaW: 1000,
		chapaH: 1000,
		espessuras: '1|2|3|5|8',
		laser: 'co2',
	},
];

export const SEED_MATERIAIS_HEADER = [
	'title',
	'familia',
	'densidade_g_cm3',
	'preco_kg',
	'chapa_w_mm',
	'chapa_h_mm',
	'espessuras',
	'laser',
] as const;

/**
 * CSV pronto para o import da coleção `materiais`.
 *
 * `laser: 'nao'` não é enfeite: PVC no laser libera cloro (vira ácido
 * clorídrico, come a máquina e o pulmão do operador), policarbonato e ABS
 * queimam/derretem em vez de cortar. Sai na base marcado para a tela poder
 * BLOQUEAR antes de alguém orçar um trabalho que não se faz.
 */
export function seedMateriaisCsv(): string {
	const linhas = SEED.map((r) => {
		const d = densidadeDe(r.familia);
		if (d === undefined) {
			// Só acontece se alguém editar SEED sem editar DENSIDADES.
			throw new ToolEngineError(
				500,
				`seed de materiais sem densidade para a família '${r.familia}'`,
			);
		}
		return [
			r.title,
			r.familia,
			d,
			r.precoKg.toFixed(2),
			r.chapaW || '',
			r.chapaH || '',
			r.espessuras,
			r.laser,
		];
	});
	// CSV montado à mão (e não com `lib/csv.ts`) para manter este diretório puro:
	// nenhum campo do seed contém vírgula, aspas ou quebra de linha — o que é
	// garantido pelo teste `quote-pricing`.
	return [
		SEED_MATERIAIS_HEADER.join(','),
		...linhas.map((l) => l.join(',')),
	].join('\n');
}
