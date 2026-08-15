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
import { brl, duracaoBR, m2BR, numeroBR, pctBR, pontosBR } from './format.js';
import {
	CLASSE_OUTRA,
	findMachineClass,
	GANHO_MENSAL_PADRAO,
	HORAS_UTEIS_PADRAO,
	LABEL_REGIME,
	MACHINE_CLASSES,
	machineClassIds,
	REGIMES_FISCAIS,
} from './machines.js';
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
 *
 * É `type` e não `interface` de PROPÓSITO. `profileFromCollectionData` escreve
 * campo a campo por nome (`perfil[f.key] = valor`, com `f.key` vindo de
 * `PROFILE_FIELDS`), e o TS só aceita esse tipo de escrita num tipo que tenha
 * índice implícito — o que um `type` de objeto tem e uma `interface` não, porque
 * interface admite declaration merging. Como `interface`, a mesma linha exigia
 * um `as Record<string, unknown>` que o compilador recusava (TS2352): um cast
 * inválido no ÚNICO arquivo do produto onde tipo errado vira preço errado.
 */
export type QuoteProfile = {
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
};

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

/**
 * Perfil inicial para quem corta em CO2 — MDF, acrílico, compensado, couro.
 *
 * POR QUE ISTO PRECISOU EXISTIR: o `DEFAULT_PROFILE` é uma fibra de 1500 W, e a
 * cascata de velocidade recusa material de CO2 num perfil de fibra (com razão —
 * MDF não corta em fibra). Quem abrisse a ferramenta sem ter criado perfil e
 * escolhesse MDF, que é o material MAIS comum do público, tomava um erro seco
 * em vez de um orçamento. Ou seja: o caminho mais provável da primeira visita
 * era o único que não funcionava.
 *
 * Números de máquina de praça: tubo de 100 W, mesa 1300×900, sem gás de
 * assistência, operador e overhead iguais aos do perfil de fibra — o que muda é
 * a máquina, não a oficina. Ninguém deve fechar preço com estes valores; eles
 * existem para a tela abrir com uma conta que FECHA, e o `avisos` do orçamento
 * diz, em texto, que saiu com valores padrão.
 */
export const DEFAULT_PROFILE_CO2: QuoteProfile = {
	...DEFAULT_PROFILE,
	laser: 'co2',
	potenciaW: 100,
	// Gravação em CO2 é mais lenta e o traço é mais grosso que em fibra.
	vGravMmS: 200,
	lineMm: 0.15,
	// Tubo + chiller + exaustão puxam bem menos que uma fonte de fibra.
	energiaKw: 2,
	// O tubo é consumível de verdade: ~R$ 1.200 a cada ~2.000 h de uso.
	consumiveisHora: 1.2,
	manutencaoHora: 1,
	valorMaquina: 25000,
	vidaUtilH: 12000,
};

/** Perfil padrão coerente com o tipo de laser do material escolhido. */
export function defaultProfileFor(laser?: LaserKind): QuoteProfile {
	return laser === 'co2' ? DEFAULT_PROFILE_CO2 : DEFAULT_PROFILE;
}

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

/** Seções do formulário, na ordem em que a tela deve desenhá-las. */
export const GRUPO_PERFIL = {
	oficina: 'A sua oficina',
	maquina: 'O que assumimos pela sua máquina',
	custo: 'O seu custo',
	preco: 'Como você fecha preço',
	material: 'Material',
	trabalho: 'Isto é do TRABALHO, não da oficina',
} as const;

/**
 * Seção e linha de ajuda de cada campo do perfil.
 *
 * O muro dos 31 campos não era só o TAMANHO — era a ORDEM. `gas_m3h` e
 * `markup_pct` apareciam no mesmo paredão, com o mesmo peso visual, e um deles
 * move o preço 0% enquanto o outro move 15%. Aqui cada campo declara em que
 * seção mora e, quando o nome não basta, o que ele quer dizer em português.
 *
 * `hint`/`group` são ignorados pelo back (`validateCollectionData` só olha tipo
 * e faixa) — quem os lê é a tela. Estão em código, e não escritos à mão no
 * seed, porque o seed é ESPELHO desta função: um `hint` que só existisse lá do
 * outro lado ia se perder na primeira vez que alguém regerasse a spec.
 */
/**
 * OS ROTAIS DAS OPÇÕES — porque `psico_9` não é uma resposta que se dê a
 * ninguém.
 *
 * A tela do perfil oferecia, na pergunta mais importante da ferramenta, um
 * `select` com `fibra_20 · co2_100 · outra`; em "Você emite nota?",
 * `sem_nota · mei · simples_comercio · simples_servicos`; em "Arredondamento",
 * `psico_9`. São ids de banco de dados servidos como resposta a um dono de
 * marcenaria. O VALOR GRAVADO continua sendo o id — trocá-lo por rótulo
 * quebraria todo registro existente e o motor não entenderia mais o campo.
 */
const PERFIL_OPCOES: Record<string, Record<string, string>> = {
	maquina_classe: {
		...Object.fromEntries(MACHINE_CLASSES.map((m) => [m.id, m.label])),
		[CLASSE_OUTRA]: 'Outra máquina (preencho tudo à mão)',
	},
	laser: { fibra: 'Fibra', co2: 'CO2' },
	regime_fiscal: LABEL_REGIME,
	precificar_por: {
		markup: 'Lucro sobre o CUSTO (markup)',
		margem: 'Margem sobre a VENDA',
	},
	arredondamento: {
		nenhum: 'Não arredondar',
		'0.50': 'Fechar nos 50 centavos (R$ 12,50)',
		'1.00': 'Fechar no real cheio (R$ 13,00)',
		psico_9: 'Terminar em 9 (R$ 12,90)',
	},
	material_basis: {
		liquido: 'Só a área da peça (o retalho é do cliente)',
		bbox: 'O retângulo que a peça ocupa (o retalho é seu)',
		chapa: 'A chapa inteira que eu compro para o pedido',
	},
};

const PERFIL_UI: Record<string, { group: string; hint?: string }> = {
	// A oficina: as respostas que o dono dá de cabeça.
	maquina_classe: {
		group: GRUPO_PERFIL.oficina,
		// A frase anterior ("já PREENCHE potência, consumo, consumíveis e valor")
		// era falsa neste formulário: quem preenche a tela é o formulário curto, e
		// aqui os campos continuavam em branco embaixo de um título que prometia o
		// contrário. O que a classe faz de verdade, sempre, é RESPONDER por esses
		// campos na hora de precificar (`baseDoPerfil`) — mesmo em branco.
		hint: 'A máquina já responde por potência, consumo, consumíveis, manutenção e valor: deixe em branco para usar o padrão dela, ou preencha para discordar.',
	},
	horas_uteis_dia: {
		group: GRUPO_PERFIL.oficina,
		hint: 'Quantas horas por dia você trabalha com ela. Define o prazo, a vida útil da máquina e a sua hora.',
	},
	ganho_mensal: {
		group: GRUPO_PERFIL.oficina,
		hint: 'Quanto você quer tirar por mês. É daqui que sai o custo da sua hora — não do salário mínimo.',
	},
	markup_pct: {
		group: GRUPO_PERFIL.oficina,
		hint: '100% = o dobro do custo = 50% de margem sobre a venda. É a MESMA decisão em duas escalas; responda uma só.',
	},
	regime_fiscal: {
		group: GRUPO_PERFIL.oficina,
		hint: '"Você emite nota?" é respondível; "quantos por cento de imposto você paga?" não é.',
	},
	pedido_minimo: {
		group: GRUPO_PERFIL.oficina,
		hint: 'O menor valor que você aceita por um pedido. No trabalho de 1 peça, é ESTE campo que decide o preço — nenhum outro.',
	},
	// A máquina: derivado da classe, editável.
	laser: { group: GRUPO_PERFIL.maquina },
	potencia_w: { group: GRUPO_PERFIL.maquina },
	v_rapid_mm_s: {
		group: GRUPO_PERFIL.maquina,
		hint: 'Em branco usa o padrão do tipo de laser. Move o preço em 0,00% — não perca tempo aqui.',
	},
	v_grav_mm_s: {
		group: GRUPO_PERFIL.maquina,
		hint: 'A que está no seu Lightburn/Ezcad. O padrão é a mediana de quem tem a mesma máquina.',
	},
	line_mm: {
		group: GRUPO_PERFIL.maquina,
		hint: 'O "line"/"intervalo" do seu programa de gravação.',
	},
	energia_kw: {
		group: GRUPO_PERFIL.maquina,
		hint: 'Máquina + chiller + exaustor, ligados.',
	},
	gas_m3h: {
		group: GRUPO_PERFIL.maquina,
		hint: 'Só quem corta metal com gás de assistência usa. CO2 de marcenaria: 0.',
	},
	preco_gas_m3: { group: GRUPO_PERFIL.maquina },
	consumiveis_hora: {
		group: GRUPO_PERFIL.maquina,
		hint: 'Tubo de CO2: preço do tubo ÷ horas de vida. Fonte de fibra dura ~100.000 h, então ali é ~0.',
	},
	manutencao_hora: { group: GRUPO_PERFIL.maquina },
	valor_maquina: { group: GRUPO_PERFIL.maquina },
	vida_util_h: {
		group: GRUPO_PERFIL.maquina,
		hint: 'Calculado das suas horas por dia em 10 anos (depreciação de 10% ao ano).',
	},
	supervisao_pct: {
		group: GRUPO_PERFIL.maquina,
		hint: 'Quanto do tempo de máquina você fica junto. Peça pequena e troca a toda hora: 100%.',
	},
	// O custo da oficina.
	preco_kwh: {
		group: GRUPO_PERFIL.custo,
		hint: 'Está na sua conta de luz. Varia de R$ 0,41 (RS) a R$ 1,47 (RJ).',
	},
	custo_hora_operador: {
		group: GRUPO_PERFIL.custo,
		hint: 'Calculado do quanto você quer ganhar por mês.',
	},
	ineficiencia_pct: {
		group: GRUPO_PERFIL.custo,
		hint: 'A máquina não corta na velocidade cheia o tempo todo: acelera, freia e vira nos cantos.',
	},
	setup_min: {
		group: GRUPO_PERFIL.custo,
		hint: 'Abrir o arquivo, fixar a chapa, focar e alinhar. Rateado pelo lote — pesa no pedido de 1 peça.',
	},
	overhead_pct: {
		group: GRUPO_PERFIL.custo,
		hint: 'Aluguel, internet, contador: o que roda mesmo com a máquina parada.',
	},
	// Como o preço fecha.
	margem_pct: {
		group: GRUPO_PERFIL.preco,
		hint: 'A mesma decisão do lucro sobre o custo, vista do outro lado. Preenchida sozinha.',
	},
	imposto_pct: { group: GRUPO_PERFIL.preco },
	precificar_por: { group: GRUPO_PERFIL.preco },
	arredondamento: {
		group: GRUPO_PERFIL.preco,
		hint: 'Sempre para CIMA — nenhuma regra de arredondamento pode derrubar o preço abaixo do custo.',
	},
	prazo_base_dias: { group: GRUPO_PERFIL.preco },
	descontos: {
		group: GRUPO_PERFIL.preco,
		hint: 'Em branco = sem desconto automático. Cuidado: 30% de desconto com 35% de lucro entrega prejuízo.',
	},
	// Material.
	material_basis: {
		group: GRUPO_PERFIL.material,
		hint: '"Retângulo" cobra a área que a peça ocupa na chapa e o retalho de dentro fica com você.',
	},
	aproveitamento_pct: { group: GRUPO_PERFIL.material },
	// Do trabalho, não da oficina — ficam aqui só para quem sempre faz igual.
	tempo_manual_min: {
		group: GRUPO_PERFIL.trabalho,
		hint: 'Deixe 0: isto muda a cada peça e é perguntado no orçamento.',
	},
	acabamento_por_peca: {
		group: GRUPO_PERFIL.trabalho,
		hint: 'Deixe 0: é o campo que mais move o preço (+42%) e ele muda a cada trabalho — pergunte no orçamento.',
	},
};

/**
 * As três perguntas curtas que NÃO existiam como campo do perfil.
 *
 * Campo não DECLARADO na coleção é descartado em silêncio na gravação — então
 * guardar "que máquina você tem" e "quanto quer ganhar por mês" exige declará-
 * los aqui. E guardá-los não é luxo: sem eles, editar o perfil amanhã voltaria
 * a ser o paredão de 31 campos, porque a tela não teria como saber quais
 * respostas geraram os derivados.
 */
function camposDasPerguntasCurtas(): CollectionFieldSpec[] {
	return [
		{
			name: 'maquina_classe',
			label: 'Que máquina você tem?',
			type: 'enum',
			required: false,
			options: machineClassIds(),
			optionLabels: PERFIL_OPCOES.maquina_classe,
			placeholder: CLASSE_OUTRA,
			...PERFIL_UI.maquina_classe,
		},
		{
			name: 'ganho_mensal',
			label: 'Quanto você quer ganhar por mês?',
			type: 'number',
			required: false,
			unit: 'R$',
			min: 0,
			max: 1_000_000,
			placeholder: String(GANHO_MENSAL_PADRAO),
			...PERFIL_UI.ganho_mensal,
		},
		{
			name: 'regime_fiscal',
			label: 'Você emite nota?',
			type: 'enum',
			required: false,
			options: [...REGIMES_FISCAIS],
			optionLabels: PERFIL_OPCOES.regime_fiscal,
			placeholder: 'simples_servicos',
			...PERFIL_UI.regime_fiscal,
		},
	];
}

/**
 * Campos do perfil como `CollectionFieldSpec[]`, para declarar a coleção
 * `perfis` com `visibility: 'owner'` (preço de custo é dado sensível: só o dono
 * vê). Zero DDL — perfil é DADO de coleção, não tabela nova.
 *
 * NENHUM CAMPO É `required`, e isso é uma decisão, não um descuido. Antes, 30
 * dos 31 eram obrigatórios e `validateCollectionData` REJEITAVA o POST se um
 * faltasse: não existia perfil parcial, só perfil inteiro ou perfil nenhum. O
 * banco deu o veredito — zero perfis criados em cerca de um ano. Quem garante
 * que o registro sai COMPLETO agora é o bloco `quote.perfil_padrao`, que grava
 * os 31 já derivados; e quem garante que um branco não vira preço de outra
 * máquina é `baseDoPerfil()` logo abaixo, que escolhe o padrão pela máquina
 * DECLARADA no próprio registro em vez de cair sempre na fibra de 1500 W.
 */
export function profileFieldsSpec(): CollectionFieldSpec[] {
	const campos: CollectionFieldSpec[] = camposDasPerguntasCurtas();
	for (const f of PROFILE_FIELDS) {
		const padrao = DEFAULT_PROFILE[f.key];
		const spec: CollectionFieldSpec = {
			name: f.name,
			label: f.label,
			type: f.type,
			required: false,
			...PERFIL_UI[f.name],
		};
		if (f.unit) spec.unit = f.unit;
		if (f.options) spec.options = f.options;
		if (PERFIL_OPCOES[f.name]) spec.optionLabels = PERFIL_OPCOES[f.name];
		if (f.min !== undefined) spec.min = f.min;
		if (f.max !== undefined) spec.max = f.max;
		if (typeof padrao === 'number') {
			spec.placeholder = String(round6(padrao / (f.fator ?? 1)));
		} else if (typeof padrao === 'string') {
			spec.placeholder = padrao;
		}
		campos.push(spec);
	}
	campos.push({
		name: 'descontos',
		label: 'Descontos por quantidade (qtd:%)',
		type: 'textarea',
		placeholder: DESCONTOS_PLACEHOLDER,
		...PERFIL_UI.descontos,
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

/**
 * De qual perfil o registro PARTE antes de aplicar o que está preenchido.
 *
 * Era `DEFAULT_PROFILE` sempre — uma fibra de 1500 W, R$ 180.000, 6 kW,
 * consumíveis a R$ 3/h. Com os 31 campos obrigatórios isso nunca aparecia
 * (tudo era sobrescrito). Agora que o perfil pode ser parcial, a base virou a
 * armadilha: medimos um perfil "CO2 100 W" com os derivados em branco saindo
 * com taxa-hora de R$ 19,10 em vez de R$ 6,18 — **+46% de sobrepreço, em
 * silêncio** (`orc/04-*.txt`).
 *
 * A ordem de preferência é a do dado mais específico que o registro declara:
 * a CLASSE da máquina, depois só o TIPO de laser, depois o padrão de sempre.
 * Registro completo (todo perfil legado é assim) não muda em NADA — todo campo
 * é sobrescrito logo em seguida.
 */
function baseDoPerfil(data: Record<string, unknown>): QuoteProfile {
	const classeId =
		typeof data.maquina_classe === 'string' ? data.maquina_classe.trim() : '';
	const maquina =
		classeId && classeId !== CLASSE_OUTRA
			? findMachineClass(classeId)
			: undefined;
	if (maquina) {
		const horas = Number(data.horas_uteis_dia);
		const horasUteisDia =
			Number.isFinite(horas) && horas > 0 ? horas : HORAS_UTEIS_PADRAO;
		return {
			...defaultProfileFor(maquina.laser),
			laser: maquina.laser,
			potenciaW: maquina.potenciaW,
			vGravMmS: maquina.vGravMmS,
			lineMm: maquina.lineMm,
			...(maquina.vRapidMmS !== undefined
				? { vRapidMmS: maquina.vRapidMmS }
				: {}),
			energiaKw: maquina.energiaKw,
			gasM3h: maquina.gasM3h,
			precoGasM3: maquina.precoGasM3,
			consumiveisHora: maquina.consumiveisHora,
			manutencaoHora: maquina.manutencaoHora,
			valorMaquina: maquina.valorMaquina,
			fatorSupervisao: round9(maquina.supervisaoPct / 100),
			horasUteisDia,
			// Mesma conta do `derivarPerfilCurto`: 22 dias, 12 meses, 10 anos de
			// depreciação (IN RFB 1700). Duplicar a constante aqui seria o começo de
			// duas verdades — é por isso que o cálculo mora em `machines.ts` e este
			// caminho só existe como REDE, para o registro que perdeu o campo.
			vidaUtilH: Math.round(horasUteisDia * 22 * 12 * 10),
		};
	}
	const laser =
		data.laser === 'co2' || data.laser === 'fibra' ? data.laser : undefined;
	// CÓPIA, sempre. `defaultProfileFor` devolve a CONSTANTE do módulo, e quem
	// chama isto escreve campo a campo por cima — sem o spread, um perfil de
	// aluno reescreveria o padrão do sistema para o processo inteiro. A suíte
	// pegou: um teste que lia `overhead_pct: 35` deixava o padrão em 35% para
	// todos os testes seguintes.
	return { ...defaultProfileFor(laser) };
}

/**
 * Campos do perfil que o registro NÃO preencheu.
 *
 * Serve para o orçamento poder dizer, em texto, de onde veio o número que o
 * aluno não deu — em vez de assumir em silêncio, que é o modo de falha que já
 * custou +46% de sobrepreço neste arquivo. Quem consome é `quote.price`.
 */
export function camposEmBrancoDoPerfil(
	data: Record<string, unknown>,
): { name: string; label: string }[] {
	const faltando: { name: string; label: string }[] = [];
	for (const f of PROFILE_FIELDS) {
		if (f.opcional) continue;
		const v = data[f.name];
		if (v === undefined || v === null || v === '') {
			faltando.push({ name: f.name, label: f.label });
		}
	}
	return faltando;
}

/** Perfil a partir de um registro da coleção (`data` do `pl_tool_bank_entry`). */
export function profileFromCollectionData(
	data: Record<string, unknown>,
): QuoteProfile {
	const perfil = baseDoPerfil(data);
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

export type AlertaSeveridade = 'erro' | 'aviso' | 'info';

/**
 * Um aviso do orçamento, do jeito que o dono da loja precisa receber: um código
 * estável para a tela decidir cor e ordem, e uma FRASE COM O NÚMERO QUE A
 * CAUSOU.
 *
 * Por que isto virou objeto e não continuou uma lista de strings: a lista antiga
 * misturava "confiança da velocidade: 0,40" com "este pedido fecha abaixo do seu
 * custo" no mesmo tom e na mesma cor. O segundo é dinheiro perdido e tem que
 * gritar; o primeiro é contexto. `avisos` continua existindo (é o que a tela e o
 * link público já leem) e é derivado daqui — os dois nunca divergem porque um é
 * projeção do outro.
 */
export interface QuoteAlerta {
	/** Chave estável, em snake_case (`preco_abaixo_do_custo`). */
	codigo: string;
	severidade: AlertaSeveridade;
	/** Rótulo curto, para o título do card na tela. */
	titulo: string;
	/** A frase inteira, em português, com os números. */
	mensagem: string;
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
		/** Só em `basis: 'chapa'`: chapas inteiras que o PEDIDO consome. */
		chapas?: number;
		/** Só em `basis: 'chapa'`: peças a mais que a sobra ainda daria. */
		sobraPecas?: number;
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
		/**
		 * O QUE SOBRA NO FIM, em reais, do pedido inteiro: o que entra líquido
		 * (depois de desconto, pedido mínimo e imposto) menos o que as peças
		 * custaram. Negativo = prejuízo.
		 *
		 * Existia só como percentual, e percentual não responde a pergunta que o
		 * dono faz ("quanto eu ganho nesse trabalho?"). Pior: `-5,8%` não assusta
		 * ninguém, `-R$ 144,76` assusta.
		 */
		lucroPedidoCents: number;
		/** O mesmo, por peça — número de exibição (o que fecha é o do pedido). */
		lucroPorPecaCents: number;
		/** Custo do lote inteiro: `custo por peça × qtd`. */
		custoLoteCents: number;
		/** O que entra de verdade depois do imposto: `total × (1 − imposto)`. */
		liquidoPedidoCents: number;
		/**
		 * PISO: menor preço unitário de tabela que ainda paga o custo com o
		 * desconto e o imposto deste pedido. Abaixo disto o trabalho dá prejuízo.
		 */
		precoUnitMinimoCents: number;
		/**
		 * O MESMO PISO, na base EFETIVA — o que o cliente paga por peça (`total ÷
		 * qtd`), que é o número que a tela estampa como manchete.
		 *
		 * Os dois existem porque são a mesma verdade em duas escalas, e misturá-las
		 * fazia a tela se contradizer: com 40% de desconto na mesa ela dizia ao
		 * mesmo tempo "cobre R$ 7,80 por peça", "sobram R$ 144,20" e "seu piso é
		 * R$ 10,45" — piso de TABELA ao lado de preço EFETIVO. Medido: 1 em cada 5
		 * orçamentos com desconto batia nessa contradição.
		 *
		 * `custo / (1 − imposto)`: o desconto não entra porque ele já está DENTRO
		 * do preço efetivo. Comparar este piso com `precoUnitEfetivoCents` é a
		 * mesma comparação que `precoUnitMinimoCents` × `precoUnitCents`.
		 */
		precoUnitMinimoEfetivoCents: number;
		/**
		 * Maior desconto que este preço aguenta sem virar prejuízo (fração).
		 * Arredondado para BAIXO: é um teto, não uma sugestão.
		 */
		descontoMaximoPct: number;
	};
	prazoDias: number;
	/**
	 * Os avisos como TEXTO, na ordem. É a projeção de `alertas` — quem consome
	 * (tela do aluno, link público, `warnings` do bloco) continua lendo strings.
	 */
	avisos: string[];
	/** Os mesmos avisos com código e severidade, para a tela dar peso a cada um. */
	alertas: QuoteAlerta[];
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

	// Tudo o que este orçamento tem a dizer entra AQUI, com código e severidade.
	// `avisos` (a lista de strings que a tela e o link público já leem) é montada
	// no fim, a partir desta — assim é impossível um aviso existir num lugar e
	// não no outro.
	const alertas: QuoteAlerta[] = options.speed.avisos
		// A cascata já grita "é ESTIMATIVA", e este arquivo grita de novo logo
		// abaixo — com a confiança e a fonte junto. Dois cartões dizendo a mesma
		// coisa é exatamente o ruído que faz o profissional parar de ler os avisos,
		// então fica o que tem número.
		.filter((m) => !(options.speed.estimativa && /ESTIMATIVA/.test(m)))
		.map((mensagem) => ({
			codigo: 'velocidade',
			severidade: 'aviso' as const,
			titulo: 'Velocidade de corte',
			mensagem,
		}));
	const alerta = (
		codigo: string,
		severidade: AlertaSeveridade,
		titulo: string,
		mensagem: string,
	) => alertas.push({ codigo, severidade, titulo, mensagem });

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
		// A QUANTIDADE entra na conta de material: em `basis: 'chapa'` é ela que
		// decide quantas chapas o pedido consome de verdade (28 peças com 27 por
		// chapa são DUAS chapas compradas, não 1,04).
		{ qty },
	);
	for (const mensagem of area.avisos) {
		alerta('material', 'aviso', 'Material', mensagem);
	}

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
		if (area.chapas !== undefined && area.chapas >= 1) {
			// Cobrando por chapa, o frete também é por CHAPA COMPRADA: são
			// `chapas` fretes, divididos pelas peças do pedido. Ratear por
			// "peças que cabem" deixaria o segundo frete fora da conta.
			const porPeca = (mat.custoFixoChapa * area.chapas) / qty;
			custoMaterial += porPeca;
			detalheFixo = ` + ${area.chapas} × ${brl(centavos(mat.custoFixoChapa))} de custo fixo da chapa, dividido por ${qty} ${qty === 1 ? 'peça' : 'peças'}`;
		} else if (n >= 1) {
			custoMaterial += mat.custoFixoChapa / n;
			detalheFixo = ` + ${brl(centavos(mat.custoFixoChapa))} de custo fixo da chapa, dividido pelas ${n} peças que saem dela`;
		} else {
			custoMaterial += mat.custoFixoChapa;
			detalheFixo = ` + ${brl(centavos(mat.custoFixoChapa))} de custo fixo da chapa (inteiro, sem rateio)`;
			alerta(
				'chapa_sem_rateio',
				'aviso',
				'Custo fixo da chapa',
				`o custo fixo da chapa (${brl(centavos(mat.custoFixoChapa))}) está sendo cobrado INTEIRO em cada peça: informe a largura e a altura da chapa para dividir esse valor pelas peças que saem dela.`,
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

	// O `detalhe` de cada linha é a CONTA EM PORTUGUÊS. Ele era a fórmula crua
	// ("0.1965 m² (bbox) × 3 mm × 0.75 g/cm³"), e fórmula crua não é auditoria: o
	// dono da loja precisa poder discordar de uma frase, não decifrar uma
	// expressão. Os números são exatamente os mesmos — só passaram a vir com
	// nome, unidade e motivo.
	const COMO_COBRA: Record<MaterialBasis, string> = {
		liquido: `só a área da peça, com ${pctBR(area.aproveitamento ?? profile.aproveitamentoChapa)} de aproveitamento da chapa`,
		bbox: 'o retângulo que envolve a peça (o retalho em volta é seu)',
		chapa: 'a chapa inteira que o pedido consome',
	};
	const comoCobra = COMO_COBRA[area.basis];
	const tempoUnit = duracaoBR(tUnitS);

	const linhas: QuoteLine[] = [
		{
			id: 'material',
			label: `Material — ${mat.nome}`,
			cents: centavos(custoMaterial),
			detalhe:
				peso !== undefined
					? `${m2BR(area.areaMm2)} de ${mat.espessuraMm} mm — você cobra ${comoCobra} — pesam ${numeroBR(peso, 3)} kg a ${brl(centavos(mat.precoKg ?? 0))} o quilo${detalheFixo}`
					: `${m2BR(area.areaMm2)} — você cobra ${comoCobra} — a ${brl(centavos(mat.precoM2 ?? 0))} o m²${detalheFixo}`,
		},
		{
			id: 'maquina',
			label: 'Máquina',
			cents: centavos(custoMaquina),
			detalhe: `${tempoUnit} de máquina por peça a ${brl(centavos(taxaHora))} por hora (energia, gás, consumíveis, manutenção e a máquina se pagando)`,
		},
		{
			id: 'mao_de_obra',
			label: 'Mão de obra',
			cents: centavos(custoMo),
			detalhe: `${tempoUnit} de máquina a ${brl(centavos(profile.custoHoraOperador))} por hora, cobrando ${pctBR(profile.fatorSupervisao)} desse tempo (é o quanto você fica em cima da máquina)${tempoManualMin > 0 ? ` + ${duracaoBR(tempoManualMin * 60)} de trabalho na mão, essas por inteiro` : ''}`,
		},
	];
	if (acabamento > 0) {
		linhas.push({
			id: 'acabamento',
			label: 'Acabamento',
			cents: centavos(acabamento),
			detalhe: `${brl(centavos(acabamento))} por peça de lixa, pintura, montagem — o valor que ${options.acabamentoPorPeca !== undefined ? 'você informou neste orçamento' : 'está no seu perfil'}`,
		});
	}

	// Parcela de custo REAL que o arredondamento a centavo engole. Acontece em
	// peça minúscula (EVA 2 mm, 10×10 mm: R$ 0,0012 de material) e some no
	// unitário, mas o lote é que paga: 500 peças são R$ 0,60 que não estão em
	// lugar nenhum do preço. É pouco dinheiro e é a mesma classe de erro que já
	// mordeu este produto antes — então ele fala, em vez de sumir.
	const brutos: Record<string, number> = {
		material: custoMaterial,
		maquina: custoMaquina,
		mao_de_obra: custoMo,
	};
	for (const linha of linhas) {
		const bruto = brutos[linha.id];
		if (bruto === undefined || linha.cents > 0 || bruto <= 0) continue;
		const noLoteCents = centavos(bruto * qty);
		if (noLoteCents < 1) continue; // some no lote também: não é dinheiro.
		alerta(
			'custo_abaixo_do_centavo',
			'info',
			'Custo menor que um centavo',
			`${linha.label} custa menos de um centavo por peça, então o arredondamento zera essa linha — mas no lote de ${qty} ${qty === 1 ? 'peça' : 'peças'} são ${brl(noLoteCents)} que ficaram de fora do preço.`,
		);
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
		alerta(
			'pedido_minimo',
			'info',
			'Pedido mínimo',
			`o cálculo deu ${brl(comDescontoCents)} e o seu pedido mínimo é ${brl(pedidoMinimoCents)} — é o mínimo que está sendo cobrado, não o preço da peça.`,
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

	/* ── O pedido fecha? ──────────────────────────────────────────────────────
	 *
	 * Até aqui a conta só respondia "quanto cobrar". Faltava a pergunta que o
	 * dono da loja faz depois: "e sobra alguma coisa?". O número que responde
	 * (`margemEfetivaComDescontoPct`) JÁ ERA CALCULADO e nunca virava aviso —
	 * então um perfil com markup de 35% e faixa de 30% de desconto fechava um
	 * pedido de R$ 2.646 com R$ 144,76 de PREJUÍZO, e os únicos dois avisos na
	 * tela falavam de confiança da velocidade.
	 *
	 * A álgebra do buraco: o pedido só paga o custo enquanto
	 * `(1 + markup) × (1 − desconto) ≥ 1`. Com markup de 35% o desconto máximo é
	 * 26% — e o sistema aceitava 30% sem piscar. Nada disso é opinião: são as
	 * mesmas quatro variáveis que já estavam na conta.
	 */
	const custoLoteCents = totalCents * qty;
	const liquidoPedidoCents = Math.round(
		precoTotalCents * (1 - profile.impostoPct),
	);
	const lucroPedidoCents = liquidoPedidoCents - custoLoteCents;
	const lucroPorPecaCents = Math.round(lucroPedidoCents / qty);
	// Piso do unitário: quanto a peça precisa custar na tabela para o líquido
	// pagar o custo COM o desconto e o imposto deste pedido. `ceil` porque é
	// piso — um centavo a menos já é prejuízo.
	const divisor = (1 - descontoPct) * (1 - profile.impostoPct);
	const precoUnitMinimoCents =
		divisor > 0 ? Math.ceil(totalCents / divisor) : totalCents;
	// O MESMO piso na base que a tela mostra: o preço efetivo já vem depois do
	// desconto, então aqui só o imposto entra. Ver o comentário do campo.
	const semImpostoDivisor = 1 - profile.impostoPct;
	const precoUnitMinimoEfetivoCents =
		semImpostoDivisor > 0
			? Math.ceil(totalCents / semImpostoDivisor)
			: totalCents;
	// Teto de desconto que este preço aguenta. `floor` em 0,1%: é teto, não
	// sugestão, e arredondar para cima devolveria um desconto que dá prejuízo.
	const semImposto = precoUnitCents * (1 - profile.impostoPct);
	const descontoMaximoPct =
		semImposto > 0
			? Math.max(0, Math.floor((1 - totalCents / semImposto) * 1000) / 1000)
			: 0;
	// O que o pedido daria sem o desconto — é a comparação que mostra o tamanho
	// da mordida, em reais e não em pontos percentuais.
	const lucroSemDescontoCents =
		Math.round(subtotalCents * (1 - profile.impostoPct)) - custoLoteCents;

	if (lucroPedidoCents < 0) {
		const causa =
			descontoPct > 0 && lucroSemDescontoCents > 0
				? `O desconto de ${pctBR(descontoPct)} é o que virou lucro em prejuízo: sem ele o pedido deixaria ${brl(lucroSemDescontoCents)}. O máximo que este preço aguenta é ${pctBR(descontoMaximoPct, 1)}.`
				: `Mesmo sem desconto o preço não cobre o custo: para empatar, a peça precisa sair por ${brl(precoUnitMinimoCents)} — e está saindo por ${brl(precoUnitCents)}.`;
		alerta(
			'preco_abaixo_do_custo',
			'erro',
			'Este pedido dá prejuízo',
			`você recebe ${brl(liquidoPedidoCents)} líquidos (já fora ${pctBR(profile.impostoPct)} de imposto) e as ${qty} ${qty === 1 ? 'peça custa' : 'peças custam'} ${brl(custoLoteCents)} para fazer: são ${brl(-lucroPedidoCents)} do seu bolso. ${causa}`,
		);
	} else if (lucroPedidoCents === 0) {
		alerta(
			'preco_no_custo',
			'erro',
			'Este pedido empata',
			`o pedido paga exatamente o custo (${brl(custoLoteCents)}) e não deixa nada: você trabalha de graça. Para ganhar alguma coisa, a peça precisa passar de ${brl(precoUnitMinimoCents)}.`,
		);
	} else {
		// Margem PEDIDA: a que o profissional configurou. Quando ele fecha por
		// markup, a margem equivalente é `mk/(1+mk)` — é a mesma decisão vista do
		// outro lado, e comparar markup com margem aqui daria alarme falso.
		const margemPedida =
			escolhido === 'margem'
				? profile.margemPct
				: profile.markupPct / (1 + profile.markupPct);
		const perdidos = margemPedida - margemEfetivaComDescontoPct;
		// 5 pontos percentuais: abaixo disso é ruído de arredondamento de centavo,
		// acima disso é dinheiro que o profissional achou que tinha.
		if (perdidos >= 0.05) {
			alerta(
				'margem_abaixo_da_pedida',
				'aviso',
				'Margem menor do que a sua',
				`você fecha preço com ${pctBR(margemPedida)} de margem, mas este pedido sai com ${pctBR(margemEfetivaComDescontoPct)} — ${pontosBR(perdidos)} a menos${descontoPct > 0 ? `, por causa do desconto de ${pctBR(descontoPct)}` : ''}. Em dinheiro: ${brl(lucroSemDescontoCents)} de lucro viraram ${brl(lucroPedidoCents)}.`,
			);
		}
	}

	// O arredondamento é regra do profissional, mas quando ele empurra o unitário
	// muito acima do preço calculado o efeito se multiplica por `qty` e o pedido
	// inteiro passa a ser definido pelo degrau, não pelo custo. Sem este aviso o
	// número só aparecia em `markupEfetivoPct`, que ninguém confere.
	const precoBaseCents =
		escolhido === 'markup'
			? markup.precoComImpostoCents
			: margem.precoComImpostoCents;
	if (precoBaseCents > 0 && precoUnitCents > precoBaseCents * 1.1) {
		const pct = precoUnitCents / precoBaseCents - 1;
		alerta(
			'arredondamento_infla_preco',
			'aviso',
			'O arredondamento é que está mandando',
			`o seu arredondamento (${profile.regraArredondamento}) subiu a peça de ${brl(precoBaseCents)} para ${brl(precoUnitCents)}, ${pctBR(pct)} a mais — em ${qty} ${qty === 1 ? 'peça' : 'peças'} são ${brl((precoUnitCents - precoBaseCents) * qty)} a mais no pedido, decididos pelo degrau e não pelo custo.`,
		);
	}

	if (options.speed.estimativa) {
		alerta(
			'velocidade_estimada',
			'aviso',
			'O preço é ESTIMATIVA',
			`este preço é uma ESTIMATIVA: a velocidade de corte não veio da sua máquina, é ${options.speed.source === 'modelo' ? 'a curva do modelo' : 'a mediana da comunidade'}, com ${pctBR(options.speed.confidence)} de confiança. Corte uma peça de teste antes de fechar o preço.`,
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
			chapas: area.chapas,
			sobraPecas: area.sobraPecas,
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
			lucroPedidoCents,
			lucroPorPecaCents,
			custoLoteCents,
			liquidoPedidoCents,
			precoUnitMinimoCents,
			precoUnitMinimoEfetivoCents,
			descontoMaximoPct,
		},
		prazoDias,
		// `avisos` é PROJEÇÃO de `alertas`, nunca uma segunda lista mantida à mão:
		// no dia em que alguém acrescentar um aviso só aqui, ele não existe.
		avisos: alertas.map((a) => a.mensagem),
		alertas,
	};
}

/**
 * Acrescenta alertas NA FRENTE de um orçamento já calculado, mantendo `avisos`
 * em sincronia. É como o bloco da Fábrica injeta o que só ele sabe ("sem perfil
 * de custo", "o desenho já traz 4 cópias") sem duplicar a lista de strings.
 */
export function prefixaAlertas(
	breakdown: QuoteBreakdown,
	novos: QuoteAlerta[],
): QuoteBreakdown {
	breakdown.alertas.unshift(...novos);
	breakdown.avisos = breakdown.alertas.map((a) => a.mensagem);
	return breakdown;
}
