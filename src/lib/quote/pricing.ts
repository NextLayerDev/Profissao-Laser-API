/**
 * PRECIFICADOR — custo e preço de venda de um trabalho a laser, linha a linha.
 *
 * Função PURA (`computeQuote`), sem I/O: entram as MÉTRICAS do arquivo (medidas
 * pela IR do CAD), o PERFIL do profissional (coleção `perfis`, `visibility:
 * 'owner'`) e as opções do pedido; sai um `QuoteBreakdown` INTEIRO — cada linha
 * da conta, em centavos, com a fórmula ao lado. Caixa-preta não é adotada aqui:
 * o profissional precisa poder discutir o preço com o cliente sem ligar para o
 * suporte.
 *
 * Duas regras não se negociam:
 *  1. **Nenhum número vem de LLM.** Área, comprimento, peso, tempo e preço são
 *     determinísticos e testáveis. Um modelo que "soma" valores entrega
 *     orçamento errado com aparência de certo — o pior modo de falha possível.
 *  2. **Dinheiro na saída é CENTAVO INTEIRO.** O produto já teve erro de
 *     arredondamento em cobrança. Aqui a conta roda em reais e só é convertida
 *     uma vez por linha; os totais são a SOMA das linhas já arredondadas, para
 *     que o que está na tela feche na calculadora do cliente.
 */

import type { Pt } from '../cad/ir.js';
import type { CollectionFieldSpec } from '../tool-collections.js';
import { ToolEngineError } from '../tool-errors.js';
import type { CutSpeedResult, LaserKind } from './cut-speed.js';
import {
	APROVEITAMENTO_PADRAO,
	areaCobradaMm2,
	densidadeDe,
	type MaterialBasis,
	type MaterialInput,
	pecasPorChapa,
	pesoKg,
} from './materials.js';

/* ─────────────────────────── Métricas do arquivo ─────────────────────────── */

/**
 * O que o leitor de DXF/SVG mede na IR (`lib/cad/ir.ts`) e entrega ao
 * precificador. Tudo em mm/mm², de UMA peça (a quantidade entra nas opções).
 */
export interface QuoteMetrics {
	/** Σ do comprimento dos contornos a cortar. */
	cutLengthMm: number;
	/** Quantos furos de entrada o feixe abre (1 por contorno fechado). */
	pierces: number;
	/** Área a gravar (mm²). 0/ausente = sem gravação. */
	engraveAreaMm2?: number;
	/** Área da peça com os furos JÁ descontados. */
	netAreaMm2: number;
	/** Área do retângulo envolvente. */
	bboxAreaMm2: number;
	bbox: { w: number; h: number };
	/**
	 * Ponto de entrada de cada contorno (1º vértice). Usado para medir o
	 * deslocamento em rápido. Se vier `rapidLengthMm`, este campo é ignorado.
	 */
	entryPoints?: Pt[];
	/** Deslocamento já medido (mm) — vence `entryPoints`. */
	rapidLengthMm?: number;
	/** Minutos de trabalho manual por peça (rebarba, dobra, montagem). */
	manualMinutes?: number;
}

/* ─────────────────────────── Perfil ─────────────────────────── */

export type RoundingRule = 'nenhum' | '0.50' | '1.00' | 'psico_9';

export interface DescontoFaixa {
	minQtd: number;
	/** Fração (0,05 = 5%). Na coleção o profissional digita 5. */
	pct: number;
}

/**
 * Perfil de precificação do profissional. Dinheiro em REAIS (é o que ele digita
 * na tela); percentuais em FRAÇÃO (0,20). A coleção guarda percentual em 0–100 —
 * a conversão é do `profileFromCollectionData`, e essa é a armadilha nº 1 deste
 * arquivo: um `overheadPct: 20` aqui multiplicaria o custo por 21.
 */
export interface QuoteProfile {
	laser: LaserKind;
	potenciaW: number;
	/** Velocidade de deslocamento sem corte. Ausente = padrão do laser. */
	vRapidMmS?: number;
	/** Velocidade de gravação (mm/s). */
	vGravMmS: number;
	/** Passo entre linhas da gravação (mm) — o "line" do Lightburn/Ezcad. */
	lineMm: number;
	fatorIneficiencia: number;
	/** Preparação por LOTE (s): abrir arquivo, fixar chapa, focar, alinhar. */
	setupS: number;
	tempoManualMin: number;
	/** Consumo elétrico médio (kW) da máquina + chiller + exaustão. */
	energiaKw: number;
	precoKwh: number;
	gasM3h: number;
	precoGasM3: number;
	consumiveisHora: number;
	manutencaoHora: number;
	valorMaquina: number;
	vidaUtilH: number;
	custoHoraOperador: number;
	fatorSupervisao: number;
	acabamentoPorPeca: number;
	overheadPct: number;
	markupPct: number;
	margemPct: number;
	impostoPct: number;
	precificarPor: 'markup' | 'margem';
	regraArredondamento: RoundingRule;
	pedidoMinimo: number;
	descontos: DescontoFaixa[];
	horasUteisDia: number;
	prazoBaseDias: number;
	materialBasis: MaterialBasis;
	aproveitamentoChapa: number;
}

/** Deslocamento em rápido, por tipo de máquina (mm/s). */
export const V_RAPID_PADRAO: Record<LaserKind, number> = {
	fibra: 500,
	co2: 300,
};

/**
 * Perfil inicial. Números de máquina de praça (fibra 1500 W), para a tela abrir
 * com conta que fecha — o profissional troca pelos dele.
 *
 * `markupPct: 1` e `margemPct: 0.5` são EQUIVALENTES de propósito
 * (markup = m/(1−m) → 0,5/0,5 = 1). Assim, na primeira abertura, os dois preços
 * aparecem iguais lado a lado e o profissional VÊ a relação — confundir "3× o
 * custo" com "35% de margem" é a origem clássica de quebrar preço.
 */
export const DEFAULT_PROFILE: QuoteProfile = {
	laser: 'fibra',
	potenciaW: 1500,
	vGravMmS: 300,
	lineMm: 0.1,
	fatorIneficiencia: 0.15,
	setupS: 300,
	tempoManualMin: 0,
	energiaKw: 6,
	precoKwh: 0.95,
	gasM3h: 0,
	precoGasM3: 0,
	consumiveisHora: 3,
	manutencaoHora: 2,
	valorMaquina: 180000,
	vidaUtilH: 20000,
	custoHoraOperador: 25,
	fatorSupervisao: 0.35,
	acabamentoPorPeca: 0,
	overheadPct: 0.2,
	markupPct: 1,
	margemPct: 0.5,
	impostoPct: 0.06,
	precificarPor: 'markup',
	regraArredondamento: '0.50',
	pedidoMinimo: 50,
	descontos: [
		{ minQtd: 10, pct: 0.05 },
		{ minQtd: 50, pct: 0.1 },
		{ minQtd: 100, pct: 0.15 },
	],
	horasUteisDia: 8,
	prazoBaseDias: 2,
	materialBasis: 'bbox',
	aproveitamentoChapa: APROVEITAMENTO_PADRAO,
};

/* ───────────────── Perfil ⇄ coleção (`perfis`, visibility: owner) ───────────────── */

interface ProfileFieldDef {
	key: Exclude<keyof QuoteProfile, 'descontos'>;
	/** Nome do campo na coleção (snake_case, como o resto da Fábrica). */
	name: string;
	label: string;
	type: 'number' | 'int' | 'enum';
	unit?: string;
	options?: (string | number)[];
	/**
	 * Multiplicador aplicado ao valor da COLEÇÃO para chegar ao do perfil:
	 * percentual 20 → 0,20 (`fator: 0.01`), setup em min → s (`fator: 60`).
	 */
	fator?: number;
	min?: number;
	max?: number;
	opcional?: boolean;
}

const PROFILE_FIELDS: ProfileFieldDef[] = [
	{
		key: 'laser',
		name: 'laser',
		label: 'Tipo de laser',
		type: 'enum',
		options: ['fibra', 'co2'],
	},
	{
		key: 'potenciaW',
		name: 'potencia_w',
		label: 'Potência do laser',
		type: 'int',
		unit: 'W',
		min: 1,
	},
	{
		key: 'vRapidMmS',
		name: 'v_rapid_mm_s',
		label: 'Velocidade de deslocamento',
		type: 'number',
		unit: 'mm/s',
		min: 1,
		opcional: true,
	},
	{
		key: 'vGravMmS',
		name: 'v_grav_mm_s',
		label: 'Velocidade de gravação',
		type: 'number',
		unit: 'mm/s',
		min: 1,
	},
	{
		key: 'lineMm',
		name: 'line_mm',
		label: 'Passo de linha da gravação',
		type: 'number',
		unit: 'mm',
		min: 0.01,
	},
	{
		key: 'fatorIneficiencia',
		name: 'ineficiencia_pct',
		label: 'Ineficiência (aceleração/cantos)',
		type: 'number',
		unit: '%',
		fator: 0.01,
		min: 0,
		max: 200,
	},
	{
		key: 'setupS',
		name: 'setup_min',
		label: 'Preparação por pedido',
		type: 'number',
		unit: 'min',
		fator: 60,
		min: 0,
	},
	{
		key: 'tempoManualMin',
		name: 'tempo_manual_min',
		label: 'Trabalho manual por peça',
		type: 'number',
		unit: 'min',
		min: 0,
	},
	{
		key: 'energiaKw',
		name: 'energia_kw',
		label: 'Consumo elétrico',
		type: 'number',
		unit: 'kW',
		min: 0,
	},
	{
		key: 'precoKwh',
		name: 'preco_kwh',
		label: 'Preço do kWh',
		type: 'number',
		unit: 'R$',
		min: 0,
	},
	{
		key: 'gasM3h',
		name: 'gas_m3h',
		label: 'Consumo de gás',
		type: 'number',
		unit: 'm³/h',
		min: 0,
	},
	{
		key: 'precoGasM3',
		name: 'preco_gas_m3',
		label: 'Preço do gás',
		type: 'number',
		unit: 'R$/m³',
		min: 0,
	},
	{
		key: 'consumiveisHora',
		name: 'consumiveis_hora',
		label: 'Consumíveis por hora',
		type: 'number',
		unit: 'R$/h',
		min: 0,
	},
	{
		key: 'manutencaoHora',
		name: 'manutencao_hora',
		label: 'Manutenção por hora',
		type: 'number',
		unit: 'R$/h',
		min: 0,
	},
	{
		key: 'valorMaquina',
		name: 'valor_maquina',
		label: 'Valor da máquina',
		type: 'number',
		unit: 'R$',
		min: 0,
	},
	{
		key: 'vidaUtilH',
		name: 'vida_util_h',
		label: 'Vida útil da máquina',
		type: 'int',
		unit: 'h',
		min: 1,
	},
	{
		key: 'custoHoraOperador',
		name: 'custo_hora_operador',
		label: 'Custo/hora do operador',
		type: 'number',
		unit: 'R$/h',
		min: 0,
	},
	{
		key: 'fatorSupervisao',
		name: 'supervisao_pct',
		label: 'Supervisão durante a máquina',
		type: 'number',
		unit: '%',
		fator: 0.01,
		min: 0,
		max: 100,
	},
	{
		key: 'acabamentoPorPeca',
		name: 'acabamento_por_peca',
		label: 'Acabamento por peça',
		type: 'number',
		unit: 'R$',
		min: 0,
	},
	{
		key: 'overheadPct',
		name: 'overhead_pct',
		label: 'Overhead (aluguel, luz, admin)',
		type: 'number',
		unit: '%',
		fator: 0.01,
		min: 0,
		max: 200,
	},
	{
		key: 'markupPct',
		name: 'markup_pct',
		label: 'Markup sobre o custo',
		type: 'number',
		unit: '%',
		fator: 0.01,
		min: 0,
	},
	{
		key: 'margemPct',
		name: 'margem_pct',
		label: 'Margem sobre a venda',
		type: 'number',
		unit: '%',
		fator: 0.01,
		min: 0,
		max: 95,
	},
	{
		key: 'impostoPct',
		name: 'imposto_pct',
		label: 'Imposto sobre a nota',
		type: 'number',
		unit: '%',
		fator: 0.01,
		min: 0,
		max: 95,
	},
	{
		key: 'precificarPor',
		name: 'precificar_por',
		label: 'Fechar preço por',
		type: 'enum',
		options: ['markup', 'margem'],
	},
	{
		key: 'regraArredondamento',
		name: 'arredondamento',
		label: 'Arredondamento do preço',
		type: 'enum',
		options: ['nenhum', '0.50', '1.00', 'psico_9'],
	},
	{
		key: 'pedidoMinimo',
		name: 'pedido_minimo',
		label: 'Pedido mínimo',
		type: 'number',
		unit: 'R$',
		min: 0,
	},
	{
		key: 'horasUteisDia',
		name: 'horas_uteis_dia',
		label: 'Horas úteis por dia',
		type: 'number',
		unit: 'h',
		min: 0.5,
		max: 24,
	},
	{
		key: 'prazoBaseDias',
		name: 'prazo_base_dias',
		label: 'Prazo base',
		type: 'int',
		unit: 'dias',
		min: 0,
	},
	{
		key: 'materialBasis',
		name: 'material_basis',
		label: 'Como cobrar o material',
		type: 'enum',
		options: ['liquido', 'bbox', 'chapa'],
	},
	{
		key: 'aproveitamentoChapa',
		name: 'aproveitamento_pct',
		label: 'Aproveitamento da chapa',
		type: 'number',
		unit: '%',
		fator: 0.01,
		min: 1,
		max: 100,
	},
];

/** Formato do campo de faixas de desconto na coleção: uma faixa por linha. */
const DESCONTOS_PLACEHOLDER = '10:5\n50:10\n100:15';

/**
 * Campos do perfil como `CollectionFieldSpec[]`, para declarar a coleção
 * `perfis` com `visibility: 'owner'` (preço de custo é dado sensível: só o dono
 * vê). Zero DDL — perfil é DADO de coleção, não tabela nova.
 */
export function profileFieldsSpec(): CollectionFieldSpec[] {
	const campos: CollectionFieldSpec[] = PROFILE_FIELDS.map((f) => {
		const padrao = DEFAULT_PROFILE[f.key];
		const spec: CollectionFieldSpec = {
			name: f.name,
			label: f.label,
			type: f.type,
			required: !f.opcional,
		};
		if (f.unit) spec.unit = f.unit;
		if (f.options) spec.options = f.options;
		if (f.min !== undefined) spec.min = f.min;
		if (f.max !== undefined) spec.max = f.max;
		if (typeof padrao === 'number') {
			spec.placeholder = String(round6(padrao / (f.fator ?? 1)));
		} else if (typeof padrao === 'string') {
			spec.placeholder = padrao;
		}
		return spec;
	});
	campos.push({
		name: 'descontos',
		label: 'Descontos por quantidade (qtd:%)',
		type: 'textarea',
		placeholder: DESCONTOS_PLACEHOLDER,
	});
	return campos;
}

/** Faixas de desconto a partir do texto `qtd:pct`, uma por linha. */
export function parseDescontos(texto: string): DescontoFaixa[] {
	const faixas: DescontoFaixa[] = [];
	for (const parte of texto.split(/[\n;,]+/)) {
		const t = parte.trim();
		if (!t) continue;
		const m = /^(\d+(?:\.\d+)?)\s*[:=x]\s*(\d+(?:[.,]\d+)?)\s*%?$/.exec(t);
		if (!m) {
			throw new ToolEngineError(
				400,
				`faixa de desconto inválida: '${t}' (use "quantidade:percentual", ex.: 50:10)`,
			);
		}
		const minQtd = Number(m[1]);
		const pct = Number(m[2].replace(',', '.')) / 100;
		if (pct >= 1) {
			throw new ToolEngineError(
				400,
				`desconto de ${m[2]}% zera ou inverte o preço na faixa de ${minQtd} peças`,
			);
		}
		faixas.push({ minQtd, pct });
	}
	return faixas.sort((a, b) => a.minQtd - b.minQtd);
}

export function serializeDescontos(faixas: DescontoFaixa[]): string {
	return faixas.map((f) => `${f.minQtd}:${round6(f.pct * 100)}`).join('\n');
}

/** Perfil a partir de um registro da coleção (`data` do `pl_tool_bank_entry`). */
export function profileFromCollectionData(
	data: Record<string, unknown>,
): QuoteProfile {
	const perfil = { ...DEFAULT_PROFILE };
	for (const f of PROFILE_FIELDS) {
		const bruto = data[f.name];
		if (bruto === undefined || bruto === null || bruto === '') continue;
		if (f.type === 'enum') {
			const v = String(bruto);
			if (!f.options?.includes(v)) {
				throw new ToolEngineError(
					400,
					`valor inválido em '${f.name}': '${v}' (aceito: ${f.options?.join(', ')})`,
				);
			}
			// O union de cada enum já é validado por `options` acima.
			(perfil as Record<string, unknown>)[f.key] = v;
			continue;
		}
		const n =
			typeof bruto === 'number'
				? bruto
				: Number(String(bruto).replace(',', '.'));
		if (!Number.isFinite(n)) {
			throw new ToolEngineError(
				400,
				`valor não numérico em '${f.name}': '${String(bruto)}'`,
			);
		}
		if (f.min !== undefined && n < f.min) {
			throw new ToolEngineError(
				400,
				`'${f.name}' abaixo do mínimo (${f.min}): ${n}`,
			);
		}
		if (f.max !== undefined && n > f.max) {
			throw new ToolEngineError(
				400,
				`'${f.name}' acima do máximo (${f.max}): ${n}`,
			);
		}
		(perfil as Record<string, unknown>)[f.key] = round9(n * (f.fator ?? 1));
	}
	// Campo em BRANCO é "não dou desconto por quantidade", não "use as faixas do
	// sistema". O que está na tela é PLACEHOLDER, e `descontos` é o único campo do
	// perfil sem `required` — herdar as faixas do DEFAULT_PROFILE dava 5/10/15% de
	// desconto que o profissional nunca cadastrou, e o round-trip ainda gravava
	// essas faixas no perfil dele como se fossem escolha sua.
	perfil.descontos =
		typeof data.descontos === 'string' && data.descontos.trim() !== ''
			? parseDescontos(data.descontos)
			: [];
	return perfil;
}

/** Caminho de volta (perfil → registro da coleção), para a tela de edição. */
export function profileToCollectionData(
	profile: QuoteProfile,
): Record<string, unknown> {
	const data: Record<string, unknown> = {};
	for (const f of PROFILE_FIELDS) {
		const v = profile[f.key];
		if (v === undefined) continue;
		data[f.name] = typeof v === 'number' ? round6(v / (f.fator ?? 1)) : v;
	}
	data.descontos = serializeDescontos(profile.descontos);
	return data;
}

/* ─────────────────────── Deslocamento (rápido) ─────────────────────── */

/** Acima deste nº de contornos o 2-opt não paga o próprio custo. */
export const TRAVEL_2OPT_MAX_N = 200;
export const TRAVEL_2OPT_MAX_SWAPS = 2000;
export const TRAVEL_2OPT_MAX_MS = 150;

export interface TravelOpts {
	/** Origem do cabeçote. Padrão: canto superior esquerdo do desenho. */
	start?: Pt;
	twoOptMaxN?: number;
	twoOptMaxSwaps?: number;
	twoOptMaxMs?: number;
}

export interface TravelResult {
	/** Índices de `points` na ordem de visita. */
	order: number[];
	lengthMm: number;
	twoOpt: boolean;
	swaps: number;
}

function dist(a: Pt, b: Pt): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Ordena os pontos de entrada e mede o deslocamento em rápido.
 *
 * Nearest-neighbour com GRADE ESPACIAL (O(n) amortizado no lugar do O(n²) do
 * varre-tudo), partindo de `(minX, maxY)` — o canto de onde quase toda máquina
 * referencia o zero. Depois, **2-opt limitado**, e só se `n ≤ 200`:
 *
 * - acima de 200 contornos o ganho do 2-opt fica abaixo de 5% e o custo explode
 *   (é O(n²) por passada, e uma passada não basta);
 * - o NN sozinho fica ~25% acima do ótimo, e 25% do deslocamento é RUÍDO perto
 *   do erro do próprio modelo de velocidade de corte (que na curva paramétrica
 *   vale ±40%). Gastar 3 s de CPU para melhorar o 4º dígito de uma estimativa é
 *   perder tempo do profissional, não ganhar precisão.
 *
 * O teto de trocas/tempo existe porque orçamento roda dentro de request HTTP:
 * um caso patológico não pode segurar a fila.
 */
export function travelOrder(points: Pt[], opts: TravelOpts = {}): TravelResult {
	const n = points.length;
	if (n === 0) return { order: [], lengthMm: 0, twoOpt: false, swaps: 0 };

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const p of points) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	const start = opts.start ?? { x: minX, y: maxY };

	// Célula da grade: ~√n células por eixo, dimensionada pelo MAIOR lado.
	//
	// Armadilha (já custou um travamento): dimensionar por `sqrt(w·h/n)` explode
	// quando o desenho é degenerado. Uma fileira de furos na mesma linha tem
	// h = 0 → célula ~0 → milhares de células por eixo → o anel de busca varre
	// 10^11 posições e o orçamento nunca responde. Com o maior lado a grade fica
	// grosseira nesse caso, que é exatamente o certo: é uma grade 1×N.
	const w = maxX - minX;
	const h = maxY - minY;
	const span = Math.max(w, h);
	const cell = span > 0 ? span / Math.max(1, Math.ceil(Math.sqrt(n))) : 1;
	const nx = Math.floor(w / cell) + 1;
	const ny = Math.floor(h / cell) + 1;
	const buckets = new Map<string, number[]>();
	const ci = (p: Pt) => Math.floor((p.x - minX) / cell);
	const cj = (p: Pt) => Math.floor((p.y - minY) / cell);
	for (let i = 0; i < n; i++) {
		const k = `${ci(points[i])},${cj(points[i])}`;
		const b = buckets.get(k);
		if (b) b.push(i);
		else buckets.set(k, [i]);
	}

	const visitado = new Uint8Array(n);
	const order: number[] = [];
	let cur = start;
	let lengthMm = 0;
	const maxR = nx + ny + 2;

	for (let feitos = 0; feitos < n; feitos++) {
		const i0 = ci(cur);
		const j0 = cj(cur);
		let melhor = -1;
		let melhorD2 = Number.POSITIVE_INFINITY;

		const varreCelula = (ix: number, iy: number) => {
			const b = buckets.get(`${ix},${iy}`);
			if (!b) return;
			for (const idx of b) {
				if (visitado[idx]) continue;
				const dx = points[idx].x - cur.x;
				const dy = points[idx].y - cur.y;
				const d2 = dx * dx + dy * dy;
				if (d2 < melhorD2) {
					melhorD2 = d2;
					melhor = idx;
				}
			}
		};

		for (let r = 0; r <= maxR; r++) {
			// Um ponto no anel r está a pelo menos (r-1)·cell de `cur`: se o melhor
			// já achado é mais perto que isso, nenhum anel adiante melhora.
			if (melhor >= 0 && r > 0 && melhorD2 <= ((r - 1) * cell) ** 2) break;
			if (r === 0) {
				varreCelula(i0, j0);
				continue;
			}
			// Só o PERÍMETRO do anel (O(r)), nunca o quadrado inteiro (O(r²)).
			for (let di = -r; di <= r; di++) {
				varreCelula(i0 + di, j0 - r);
				varreCelula(i0 + di, j0 + r);
			}
			for (let dj = -r + 1; dj <= r - 1; dj++) {
				varreCelula(i0 - r, j0 + dj);
				varreCelula(i0 + r, j0 + dj);
			}
		}
		if (melhor < 0) break; // defensivo: não deveria ocorrer
		visitado[melhor] = 1;
		lengthMm += Math.sqrt(melhorD2);
		order.push(melhor);
		cur = points[melhor];
	}

	const maxN = opts.twoOptMaxN ?? TRAVEL_2OPT_MAX_N;
	if (n < 3 || n > maxN) return { order, lengthMm, twoOpt: false, swaps: 0 };

	// 2-opt em CAMINHO ABERTO (não é ciclo: a máquina não volta ao ponto de
	// partida). `seq[0]` é a origem e fica fixa; o último nó não tem sucessor,
	// então reverter a cauda também é uma troca válida.
	const seq: Pt[] = [start, ...order.map((i) => points[i])];
	const ordem = [...order];
	const t0 = Date.now();
	const maxSwaps = opts.twoOptMaxSwaps ?? TRAVEL_2OPT_MAX_SWAPS;
	const maxMs = opts.twoOptMaxMs ?? TRAVEL_2OPT_MAX_MS;
	let swaps = 0;
	let melhorou = true;
	let iter = 0;
	while (melhorou && swaps < maxSwaps) {
		melhorou = false;
		for (let i = 1; i < seq.length - 1 && swaps < maxSwaps; i++) {
			for (let j = i + 1; j < seq.length && swaps < maxSwaps; j++) {
				if ((++iter & 63) === 0 && Date.now() - t0 > maxMs) {
					return {
						order: ordem,
						lengthMm: pathLength(seq),
						twoOpt: true,
						swaps,
					};
				}
				const antes =
					dist(seq[i - 1], seq[i]) +
					(j + 1 < seq.length ? dist(seq[j], seq[j + 1]) : 0);
				const depois =
					dist(seq[i - 1], seq[j]) +
					(j + 1 < seq.length ? dist(seq[i], seq[j + 1]) : 0);
				if (depois < antes - 1e-9) {
					for (let a = i, b = j; a < b; a++, b--) {
						[seq[a], seq[b]] = [seq[b], seq[a]];
						[ordem[a - 1], ordem[b - 1]] = [ordem[b - 1], ordem[a - 1]];
					}
					swaps++;
					melhorou = true;
				}
			}
		}
	}
	return { order: ordem, lengthMm: pathLength(seq), twoOpt: true, swaps };
}

function pathLength(seq: Pt[]): number {
	let s = 0;
	for (let i = 1; i < seq.length; i++) s += dist(seq[i - 1], seq[i]);
	return s;
}

/** Comprimento do deslocamento em rápido (mm) para os pontos de entrada. */
export function travelLengthMm(points: Pt[], opts: TravelOpts = {}): number {
	return travelOrder(points, opts).lengthMm;
}

/* ─────────────────────── Arredondamento e centavos ─────────────────────── */

/** Reais → centavos inteiros. Único ponto de conversão de dinheiro do módulo. */
export function centavos(reais: number): number {
	if (!Number.isFinite(reais)) {
		throw new ToolEngineError(
			500,
			`valor monetário inválido no orçamento: ${reais}`,
		);
	}
	return Math.round(reais * 100);
}

function round6(v: number): number {
	return Math.round(v * 1e6) / 1e6;
}

function round3(v: number): number {
	return Math.round(v * 1e3) / 1e3;
}

/**
 * Corta o ruído de ponto flutuante da conversão de unidade. Sem isto,
 * `35 × 0,01` devolve 0,35000000000000003 e o perfil deixa de fazer round-trip
 * com a coleção — o que quebraria comparação e teste sem mudar nada de real.
 */
function round9(v: number): number {
	return Math.round(v * 1e9) / 1e9;
}

/**
 * Arredonda o preço unitário (em centavos) pela regra do profissional.
 *
 * Sempre para CIMA: arredondar preço para baixo come margem em silêncio, e
 * ninguém revisa preço que "deu um número redondo bonito".
 * `psico_9` = preço psicológico terminado em ,90 (R$ 39,90).
 */
export function arredondaCents(cents: number, regra: RoundingRule): number {
	const c = Math.ceil(cents);
	if (c <= 0) return 0;
	switch (regra) {
		case 'nenhum':
			return c;
		case '0.50':
			return Math.ceil(c / 50) * 50;
		case '1.00':
			return Math.ceil(c / 100) * 100;
		case 'psico_9': {
			const base = Math.floor(c / 100) * 100;
			return c <= base + 90 ? base + 90 : base + 190;
		}
	}
}

/* ─────────────────────────── Saída ─────────────────────────── */

export interface QuoteLine {
	id: string;
	label: string;
	/** Centavos INTEIROS. */
	cents: number;
	/** A conta com os números, para o profissional auditar na tela. */
	detalhe?: string;
}

export interface QuoteTempos {
	corteS: number;
	pierceS: number;
	rapidS: number;
	gravacaoS: number;
	/** Acréscimo do fator de ineficiência (já embutido no unitário). */
	ineficienciaS: number;
	/** Setup do lote dividido pela quantidade. */
	setupRateadoS: number;
	/** Tempo de UMA peça, com setup rateado. */
	unitarioS: number;
	/** Tempo do lote inteiro (peças × produção + setup). Só MÁQUINA. */
	loteS: number;
	/** Trabalho manual do lote (rebarba, dobra, montagem) — fora da máquina. */
	manualS: number;
	/**
	 * O que o lote ocupa de verdade: máquina + trabalho manual. É este que dá o
	 * prazo — a peça só fica pronta depois de rebarbada e montada.
	 */
	loteComManualS: number;
}

export interface QuotePrecoVariante {
	/** Percentual usado (fração). */
	pct: number;
	precoLiquidoCents: number;
	impostoCents: number;
	precoComImpostoCents: number;
	/** Depois do arredondamento — é o preço que vai para o cliente. */
	precoUnitCents: number;
	/** Margem sobre a venda que o preço final REALMENTE entrega. */
	margemEfetivaPct: number;
	/** Markup sobre o custo que o preço final REALMENTE entrega. */
	markupEfetivoPct: number;
}

export interface QuoteBreakdown {
	qty: number;
	tempos: QuoteTempos;
	material: {
		nome: string;
		basis: MaterialBasis;
		areaCobradaMm2: number;
		areaPecaMm2: number;
		espessuraMm: number;
		densidade?: number;
		pesoKg?: number;
		pecasPorChapa?: number;
		/** Preço de compra do material, em centavos (por kg / por m²). */
		precoKgCents?: number;
		precoM2Cents?: number;
	};
	velocidade: {
		speedMmS: number;
		passes: number;
		pierceS: number;
		source: CutSpeedResult['source'];
		confidence: number;
		estimativa: boolean;
		detalhe: string;
	};
	maquina: { taxaHoraCents: number };
	custos: {
		/** Linhas do custo direto, na ordem de exibição. */
		linhas: QuoteLine[];
		diretoCents: number;
		overheadCents: number;
		/** Custo por peça (direto + overhead), em centavos. */
		totalCents: number;
	};
	precos: {
		markup: QuotePrecoVariante;
		margem: QuotePrecoVariante;
		/** Qual das duas fechou o preço deste orçamento. */
		escolhido: 'markup' | 'margem';
		precoUnitCents: number;
		descontoPct: number;
		descontoFaixaMinQtd?: number;
		subtotalCents: number;
		descontoCents: number;
		precoTotalCents: number;
		pedidoMinimoCents: number;
		aplicouPedidoMinimo: boolean;
		impostoPct: number;
		/**
		 * Unitário que o cliente realmente paga: `precoTotalCents / qty`. Difere de
		 * `precoUnitCents` quando entra desconto de faixa ou pedido mínimo — e é
		 * este que tem que aparecer no documento que vai para o cliente, senão a
		 * conta dele (`qty × unitário`) não fecha com o total.
		 */
		precoUnitEfetivoCents: number;
		/**
		 * Margem/markup do pedido DEPOIS de desconto e pedido mínimo. O desconto de
		 * faixa é automático, então `markup.margemEfetivaPct` (pré-desconto) não é
		 * o número que decide se o pedido dá lucro.
		 */
		margemEfetivaComDescontoPct: number;
		markupEfetivoComDescontoPct: number;
	};
	prazoDias: number;
	avisos: string[];
}

export interface QuoteOptions {
	qty: number;
	material: MaterialInput;
	/** Resultado da cascata de `cut-speed.ts` (quem consulta as fontes é o bloco). */
	speed: CutSpeedResult;
	/** Sobrepõe o perfil, só neste orçamento. */
	acabamentoPorPeca?: number;
	tempoManualMin?: number;
	precificarPor?: 'markup' | 'margem';
	/** Desconto negociado à mão (fração). Vence a faixa por quantidade. */
	descontoPct?: number;
	travel?: TravelOpts;
}

/**
 * taxa_hora = energia·preço_kWh + gás·preço_gás + consumíveis + manutenção
 *             + valor_da_máquina / vida_útil
 *
 * A depreciação entra como custo por hora de USO (e não como despesa fixa
 * mensal) porque é assim que ela vira preço: a máquina que ficou parada não
 * gastou vida útil, e o trabalho que a ocupou 4 h precisa pagar 4 h dela.
 */
export function taxaHoraMaquina(profile: QuoteProfile): number {
	const depreciacao =
		profile.vidaUtilH > 0 ? profile.valorMaquina / profile.vidaUtilH : 0;
	return (
		profile.energiaKw * profile.precoKwh +
		profile.gasM3h * profile.precoGasM3 +
		profile.consumiveisHora +
		profile.manutencaoHora +
		depreciacao
	);
}

/** Faixa aplicável: o MAIOR `minQtd` que ainda é ≤ quantidade. */
export function faixaDesconto(
	faixas: DescontoFaixa[],
	qty: number,
): DescontoFaixa | undefined {
	let escolhida: DescontoFaixa | undefined;
	for (const f of faixas) {
		if (f.minQtd <= qty && (!escolhida || f.minQtd > escolhida.minQtd)) {
			escolhida = f;
		}
	}
	return escolhida;
}

function variante(
	tipo: 'markup' | 'margem',
	pct: number,
	custoTotalCents: number,
	impostoPct: number,
	regra: RoundingRule,
): QuotePrecoVariante {
	// markup: preço_líq = custo · (1 + markup)     → "3× o custo" = markup 200%
	// margem: preço_líq = custo / (1 − margem)     → margem é sobre a VENDA
	// Os dois chegam ao MESMO preço quando markup = m/(1−m). São a mesma conta
	// vista de dois lados, e trocar um pelo outro é o erro clássico que quebra
	// preço: 35% de markup é margem de 26%, não de 35%.
	const precoLiquidoCents =
		tipo === 'markup'
			? Math.round(custoTotalCents * (1 + pct))
			: Math.round(custoTotalCents / (1 - pct));
	// Gross-up: o imposto incide sobre o valor da NOTA, então some por dentro.
	// Somar `custo · imposto` deixaria o preço por baixo do imposto que a nota vai
	// cobrar de fato.
	const precoComImpostoCents = Math.round(precoLiquidoCents / (1 - impostoPct));
	const precoUnitCents = arredondaCents(precoComImpostoCents, regra);
	const liquidoFinal = precoUnitCents * (1 - impostoPct);
	return {
		pct,
		precoLiquidoCents,
		impostoCents: precoComImpostoCents - precoLiquidoCents,
		precoComImpostoCents,
		precoUnitCents,
		margemEfetivaPct:
			liquidoFinal > 0
				? round6((liquidoFinal - custoTotalCents) / liquidoFinal)
				: 0,
		markupEfetivoPct:
			custoTotalCents > 0 ? round6(liquidoFinal / custoTotalCents - 1) : 0,
	};
}

/**
 * Custo e preço de um trabalho. PURA: mesmas entradas → mesma saída, sempre.
 */
export function computeQuote(
	metrics: QuoteMetrics,
	profile: QuoteProfile,
	options: QuoteOptions,
): QuoteBreakdown {
	const qty = Math.floor(options.qty);
	if (!(qty >= 1)) {
		throw new ToolEngineError(400, `quantidade inválida: ${options.qty}`);
	}
	if (!(metrics.cutLengthMm >= 0) || !(metrics.netAreaMm2 >= 0)) {
		throw new ToolEngineError(
			400,
			'métricas do arquivo inválidas (comprimento/área negativos)',
		);
	}
	if (profile.margemPct >= 1) {
		throw new ToolEngineError(
			400,
			'margem de 100% sobre a venda é preço infinito — use markup ou reduza a margem',
		);
	}
	if (profile.impostoPct >= 1) {
		throw new ToolEngineError(
			400,
			'imposto de 100% sobre a nota é preço infinito',
		);
	}

	const avisos: string[] = [...options.speed.avisos];

	/* ── Tempos ───────────────────────────────────────────────────────────── */
	const { speedMmS, passes, pierceS } = options.speed;
	// `resolveCutSpeed` já garante isto, mas o precificador não confia em quem o
	// chama: velocidade 0 viraria tempo infinito e preço NaN algumas linhas abaixo.
	if (!(speedMmS > 0) || !(passes >= 1)) {
		throw new ToolEngineError(
			400,
			`velocidade de corte inválida no orçamento: ${speedMmS} mm/s × ${passes} passada(s)`,
		);
	}
	const tCorteS = (metrics.cutLengthMm / speedMmS) * passes;
	const tPierceS = Math.max(0, metrics.pierces) * pierceS;

	const vRapid = profile.vRapidMmS ?? V_RAPID_PADRAO[profile.laser];
	const rapidMm =
		metrics.rapidLengthMm ??
		(metrics.entryPoints && metrics.entryPoints.length > 0
			? travelLengthMm(metrics.entryPoints, options.travel)
			: 0);
	const tRapidS = vRapid > 0 ? rapidMm / vRapid : 0;

	const areaGravada = metrics.engraveAreaMm2 ?? 0;
	const passoGrav = profile.vGravMmS * profile.lineMm;
	if (areaGravada > 0 && !(passoGrav > 0)) {
		throw new ToolEngineError(
			400,
			'gravação pedida sem velocidade/passo de linha no perfil (v_grav_mm_s e line_mm)',
		);
	}
	// area / (v · line): a cada segundo o feixe varre v·line mm² de área.
	const tGravS = areaGravada > 0 ? areaGravada / passoGrav : 0;

	const somaBruta = tCorteS + tPierceS + tRapidS + tGravS;
	// O fator de ineficiência paga o que o modelo linear L/v ignora: a máquina
	// acelera e desacelera em CADA canto. Um contorno com 200 cantos leva bem
	// mais que L/v, e sem este fator todo orçamento de peça recortada sai barato.
	const tProducaoS = somaBruta * (1 + profile.fatorIneficiencia);
	const setupRateadoS = profile.setupS / qty;
	const tUnitS = tProducaoS + setupRateadoS;
	const tLoteS = tProducaoS * qty + profile.setupS;

	// Trabalho manual (rebarba, dobra, montagem) é COBRADO em `custoMo` mas não
	// sai da máquina — e mesmo assim ocupa o dia do profissional. Sem ele no
	// prazo, 500 h de montagem eram prometidas junto com 8 h de corte.
	const tempoManualMin =
		options.tempoManualMin ?? metrics.manualMinutes ?? profile.tempoManualMin;
	const tManualLoteS = Math.max(0, tempoManualMin) * 60 * qty;

	const tempos: QuoteTempos = {
		corteS: round3(tCorteS),
		pierceS: round3(tPierceS),
		rapidS: round3(tRapidS),
		gravacaoS: round3(tGravS),
		ineficienciaS: round3(tProducaoS - somaBruta),
		setupRateadoS: round3(setupRateadoS),
		unitarioS: round3(tUnitS),
		loteS: round3(tLoteS),
		manualS: round3(tManualLoteS),
		loteComManualS: round3(tLoteS + tManualLoteS),
	};

	/* ── Material ─────────────────────────────────────────────────────────── */
	const mat = options.material;
	const basis = mat.basis ?? profile.materialBasis;
	const area = areaCobradaMm2(
		{
			netAreaMm2: metrics.netAreaMm2,
			bboxAreaMm2: metrics.bboxAreaMm2,
			bbox: metrics.bbox,
		},
		{
			...mat,
			basis,
			aproveitamento: mat.aproveitamento ?? profile.aproveitamentoChapa,
		},
	);
	avisos.push(...area.avisos);

	let custoMaterial: number;
	let peso: number | undefined;
	const densidade = mat.densidade ?? densidadeDe(mat.familia ?? mat.nome);
	if (mat.precoKg !== undefined && mat.precoKg > 0) {
		if (densidade === undefined) {
			throw new ToolEngineError(
				400,
				`sem densidade para '${mat.familia ?? mat.nome}': preencha densidade_g_cm3 no material (ou informe preço por m²)`,
			);
		}
		peso = pesoKg(area.areaMm2, mat.espessuraMm, densidade);
		custoMaterial = peso * mat.precoKg;
	} else if (mat.precoM2 !== undefined && mat.precoM2 > 0) {
		custoMaterial = (area.areaMm2 / 1e6) * mat.precoM2;
	} else {
		throw new ToolEngineError(
			400,
			`material '${mat.nome}' sem preço: informe preco_kg ou preco_m2`,
		);
	}

	// Custo fixo da chapa (frete, corte no fornecedor) rateado pelas peças que
	// saem dela. Sem as medidas da chapa não há como ratear — some inteiro e
	// avise, em vez de sumir com o custo.
	let detalheFixo = '';
	if (mat.custoFixoChapa && mat.custoFixoChapa > 0) {
		const n =
			area.pecasPorChapa ??
			(mat.chapaWmm && mat.chapaHmm
				? pecasPorChapa(
						metrics.bbox.w,
						metrics.bbox.h,
						mat.chapaWmm,
						mat.chapaHmm,
						{
							permitirRotacao: mat.permitirRotacao,
						},
					)
				: 0);
		if (n >= 1) {
			custoMaterial += mat.custoFixoChapa / n;
			detalheFixo = ` + custo fixo da chapa R$ ${mat.custoFixoChapa.toFixed(2)} ÷ ${n} peças`;
		} else {
			custoMaterial += mat.custoFixoChapa;
			detalheFixo = ` + custo fixo da chapa R$ ${mat.custoFixoChapa.toFixed(2)} (sem rateio)`;
			avisos.push(
				'custo fixo da chapa cobrado inteiro por peça: informe as medidas da chapa para ratear',
			);
		}
	}

	/* ── Máquina, mão de obra, acabamento ─────────────────────────────────── */
	const taxaHora = taxaHoraMaquina(profile);
	const custoMaquina = (tUnitS / 3600) * taxaHora;

	// O operador não fica 100% na máquina enquanto ela corta — ele supervisiona
	// (fator ~0,35) e trabalha em outra coisa. O trabalho MANUAL, ao contrário, é
	// hora cheia dele.
	const custoMo =
		(tUnitS / 3600) * profile.custoHoraOperador * profile.fatorSupervisao +
		(tempoManualMin / 60) * profile.custoHoraOperador;

	const acabamento = options.acabamentoPorPeca ?? profile.acabamentoPorPeca;

	const linhas: QuoteLine[] = [
		{
			id: 'material',
			label: `Material — ${mat.nome}`,
			cents: centavos(custoMaterial),
			detalhe:
				peso !== undefined
					? `${(area.areaMm2 / 1e6).toFixed(4)} m² (${area.basis}) × ${mat.espessuraMm} mm × ${densidade} g/cm³ = ${peso.toFixed(3)} kg × R$ ${(mat.precoKg ?? 0).toFixed(2)}/kg${detalheFixo}`
					: `${(area.areaMm2 / 1e6).toFixed(4)} m² (${area.basis}) × R$ ${(mat.precoM2 ?? 0).toFixed(2)}/m²${detalheFixo}`,
		},
		{
			id: 'maquina',
			label: 'Máquina',
			cents: centavos(custoMaquina),
			detalhe: `${(tUnitS / 60).toFixed(2)} min × R$ ${taxaHora.toFixed(2)}/h`,
		},
		{
			id: 'mao_de_obra',
			label: 'Mão de obra',
			cents: centavos(custoMo),
			detalhe: `${(tUnitS / 60).toFixed(2)} min × R$ ${profile.custoHoraOperador.toFixed(2)}/h × ${(profile.fatorSupervisao * 100).toFixed(0)}% de supervisão${tempoManualMin > 0 ? ` + ${tempoManualMin} min manuais` : ''}`,
		},
	];
	if (acabamento > 0) {
		linhas.push({
			id: 'acabamento',
			label: 'Acabamento',
			cents: centavos(acabamento),
			detalhe: 'por peça, do perfil/pedido',
		});
	}

	// O total é a SOMA das linhas já arredondadas: assim a coluna da tela fecha
	// no centavo, em vez de exibir parcelas que não somam o total.
	const diretoCents = linhas.reduce((s, l) => s + l.cents, 0);
	const overheadCents = Math.round(diretoCents * profile.overheadPct);
	const totalCents = diretoCents + overheadCents;

	/* ── Preço ────────────────────────────────────────────────────────────── */
	const markup = variante(
		'markup',
		profile.markupPct,
		totalCents,
		profile.impostoPct,
		profile.regraArredondamento,
	);
	const margem = variante(
		'margem',
		profile.margemPct,
		totalCents,
		profile.impostoPct,
		profile.regraArredondamento,
	);
	const escolhido = options.precificarPor ?? profile.precificarPor;
	const precoUnitCents =
		escolhido === 'markup' ? markup.precoUnitCents : margem.precoUnitCents;

	const faixa =
		options.descontoPct === undefined
			? faixaDesconto(profile.descontos, qty)
			: undefined;
	const descontoPct = options.descontoPct ?? faixa?.pct ?? 0;
	if (descontoPct >= 1) {
		throw new ToolEngineError(
			400,
			`desconto de ${descontoPct * 100}% zera o preço`,
		);
	}
	const subtotalCents = precoUnitCents * qty;
	const descontoCents = Math.round(subtotalCents * descontoPct);
	const comDescontoCents = subtotalCents - descontoCents;
	const pedidoMinimoCents = centavos(profile.pedidoMinimo);
	const aplicouPedidoMinimo = comDescontoCents < pedidoMinimoCents;
	const precoTotalCents = aplicouPedidoMinimo
		? pedidoMinimoCents
		: comDescontoCents;
	if (aplicouPedidoMinimo) {
		avisos.push(
			`pedido mínimo aplicado: o cálculo deu R$ ${(comDescontoCents / 100).toFixed(2)} e o mínimo é R$ ${profile.pedidoMinimo.toFixed(2)}`,
		);
	}

	// Unitário efetivo: é ele que o cliente consegue conferir (`qty × unitário ==
	// total`). Arredonda para CIMA para nunca publicar um unitário que, somado,
	// dê menos que o total cobrado.
	const precoUnitEfetivoCents = Math.ceil(precoTotalCents / qty);
	const liquidoEfetivo = (precoTotalCents / qty) * (1 - profile.impostoPct);
	const margemEfetivaComDescontoPct =
		liquidoEfetivo > 0
			? round6((liquidoEfetivo - totalCents) / liquidoEfetivo)
			: 0;
	const markupEfetivoComDescontoPct =
		totalCents > 0 ? round6(liquidoEfetivo / totalCents - 1) : 0;

	const prazoDias =
		Math.ceil((tLoteS + tManualLoteS) / (profile.horasUteisDia * 3600)) +
		profile.prazoBaseDias;

	// O arredondamento é regra do profissional, mas quando ele empurra o unitário
	// muito acima do preço calculado o efeito se multiplica por `qty` e o pedido
	// inteiro passa a ser definido pelo degrau, não pelo custo. Sem este aviso o
	// número só aparecia em `markupEfetivoPct`, que ninguém confere.
	const precoBaseCents =
		escolhido === 'markup'
			? markup.precoComImpostoCents
			: margem.precoComImpostoCents;
	if (precoBaseCents > 0 && precoUnitCents > precoBaseCents * 1.1) {
		const pct = Math.round((precoUnitCents / precoBaseCents - 1) * 100);
		avisos.push(
			`arredondamento (${profile.regraArredondamento}) subiu o unitário de R$ ${(precoBaseCents / 100).toFixed(2)} para R$ ${(precoUnitCents / 100).toFixed(2)} (+${pct}%) — em ${qty} peças isso vira R$ ${((precoUnitCents - precoBaseCents) * qty) / 100} a mais no pedido`,
		);
	}

	if (options.speed.estimativa) {
		avisos.push(
			`confiança da velocidade: ${options.speed.confidence.toFixed(2)} (${options.speed.source}) — o preço é ESTIMATIVA`,
		);
	}

	return {
		qty,
		tempos,
		material: {
			nome: mat.nome,
			basis: area.basis,
			areaCobradaMm2: round3(area.areaMm2),
			areaPecaMm2: round3(metrics.netAreaMm2),
			espessuraMm: mat.espessuraMm,
			densidade,
			pesoKg: peso === undefined ? undefined : round6(peso),
			pecasPorChapa: area.pecasPorChapa,
			precoKgCents:
				mat.precoKg === undefined ? undefined : centavos(mat.precoKg),
			precoM2Cents:
				mat.precoM2 === undefined ? undefined : centavos(mat.precoM2),
		},
		velocidade: {
			speedMmS: round3(speedMmS),
			passes,
			pierceS: round3(pierceS),
			source: options.speed.source,
			confidence: options.speed.confidence,
			estimativa: options.speed.estimativa,
			detalhe: options.speed.detalhe,
		},
		maquina: { taxaHoraCents: centavos(taxaHora) },
		custos: { linhas, diretoCents, overheadCents, totalCents },
		precos: {
			markup,
			margem,
			escolhido,
			precoUnitCents,
			descontoPct,
			descontoFaixaMinQtd: faixa?.minQtd,
			subtotalCents,
			descontoCents,
			precoTotalCents,
			pedidoMinimoCents,
			aplicouPedidoMinimo,
			impostoPct: profile.impostoPct,
			precoUnitEfetivoCents,
			margemEfetivaComDescontoPct,
			markupEfetivoComDescontoPct,
		},
		prazoDias,
		avisos,
	};
}
