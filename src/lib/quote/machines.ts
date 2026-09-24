/**
 * O PERFIL CURTO — seis perguntas viram os trinta e um campos do perfil de custo.
 *
 * POR QUE ISTO PRECISOU EXISTIR: a coleção `perfis` pedia 31 campos, 30 deles
 * obrigatórios, e o banco mostrava o placar honesto — ZERO perfis criados. Não
 * é que o formulário fosse chato: 13 dos 31 campos um dono de marcenaria não
 * tem como responder (consumo de gás em m³/h, vida útil em horas, supervisão em
 * %). Sem perfil, todo orçamento saía com os valores padrão do sistema, que era
 * uma fibra de 1500 W — máquina que NINGUÉM deste público tem.
 *
 * A medição que decidiu o desenho (arquivo `orc/02-*.txt`, MDF 3 mm, 10 peças):
 * errar em ±30% os seis campos de custo-hora (energia, kWh, consumíveis,
 * manutenção, valor, vida útil) TODOS DE UMA VEZ move o preço entre −13% e
 * +17%. Errar UMA resposta de acabamento move +42%. Estávamos perguntando o
 * consumo de gás para acertar 2%, e não perguntávamos os 42%.
 *
 * A DIVISÃO DE TRABALHO, e ela é deliberada:
 *
 *   • O QUE É TABELA DE MERCADO é COLEÇÃO (`maquinas`, admin). Preço de máquina,
 *     preço de tubo e consumo em kW mudam sozinhos — em 2027 o tubo não custa
 *     R$ 2.000. Um número desses não pode exigir deploy para ser corrigido, e a
 *     Fábrica existe exatamente para isso. Ver `machineFieldsSpec()`.
 *   • O QUE É CÁLCULO é CÓDIGO (este arquivo, consumido pelo bloco
 *     `quote.perfil_padrao`). "vida útil = horas/dia × 22 × 12 × 10 anos" e
 *     "hora do dono = ganho mensal ÷ horas trabalhadas" são contas, não dados:
 *     testáveis, determinísticas e — como todo o resto do dinheiro nesta
 *     ferramenta — sem passar por modelo nenhum.
 *   • `MACHINE_CLASSES` aqui embaixo é o LASTRO: a coleção começa vazia (é o
 *     estado de hoje) e uma coleção vazia não pode significar "sem padrão".
 *     Linha da coleção VENCE o lastro, campo a campo.
 *
 * E a regra que vale para as duas metades: o derivado é GRAVADO no registro do
 * aluno, nunca deixado em branco. Um perfil "CO2 100 W" com os 17 campos
 * derivados em branco herdaria o padrão de fibra 1500 W e cobraria +46% em
 * silêncio — medido, arquivo `orc/04-*.txt`. Gravar o número é o que torna o
 * perfil auditável: o aluno vê, discorda e corrige.
 */

import type { CollectionFieldSpec } from '../tool-collections.js';
import { ToolEngineError } from '../tool-errors.js';
import type { LaserKind } from './cut-speed.js';

/* ─────────────────────────── A classe de máquina ─────────────────────────── */

/**
 * Tudo que dá para saber sobre o custo de uma oficina só de saber QUAL máquina
 * ela tem. Dinheiro em reais, percentual em 0–100 (é a escala da coleção — a
 * conversão para fração é do `profileFromCollectionData`, como no resto).
 */
export interface MachineClass {
	/** Id estável. Vai gravado em `perfis.maquina_classe` e no card da tela. */
	id: string;
	label: string;
	laser: LaserKind;
	potenciaW: number;
	/** Velocidade de gravação (mm/s) — mediana real do parque, ver abaixo. */
	vGravMmS: number;
	/** Passo de linha (mm) — o "line" do Lightburn/Ezcad. */
	lineMm: number;
	/** Deslocamento sem corte. Ausente = padrão do tipo de laser. */
	vRapidMmS?: number;
	/** Máquina + chiller + exaustão, ligados (kW). */
	energiaKw: number;
	gasM3h: number;
	precoGasM3: number;
	consumiveisHora: number;
	manutencaoHora: number;
	valorMaquina: number;
	/** Quanto do tempo de máquina o operador fica junto (%). */
	supervisaoPct: number;
}

/**
 * O PARQUE REAL DESTE PÚBLICO, não o catálogo de um fabricante.
 *
 * As velocidades de gravação são a MEDIANA de 543 parâmetros que os próprios
 * alunos cadastraram (`pl_parameter`): fibra 20 W n=89 · 30 W n=133 · 50 W
 * n=110 · CO2 50–150 W n=47. Não é chute nem folheto — é o que a comunidade
 * mede na máquina dela. E foi essa medição que denunciou o padrão antigo de
 * fibra (`300 mm/s × line 0,1 = 30 mm²/s`) contra o parque real
 * (`1500 × 0,04 = 60 mm²/s`): o sistema cobrava o DOBRO do tempo de gravação de
 * quem tem fibra galvo, que é 70% do público.
 *
 * Fontes dos números de mercado (preço à vista, jul/2026):
 *   • Translaser Mini Fiber 20 W — R$ 26.991–29.990, fonte de 500 W (spec).
 *   • Mercado Laser fibra 50 W — a partir de R$ 19.530; fonte RFL-P30QS = 200 W.
 *   • Virtumaq CO2 60 W 600×400 — R$ 25.900 com chiller CW-5200 e exaustor.
 *   • OMRAK I1390 CO2 100 W 1300×900 — R$ 29.500 à vista (tabela R$ 32.000).
 *   • Tubo CO2 100 W ≈ R$ 2.000 / 8.000 h de vida (Big American, Cutmaker)
 *     → R$ 0,25/h. O padrão antigo usava R$ 1,20/h — cinco vezes o mercado.
 *   • Raycus: fonte de fibra com 100.000 h declaradas → consumível ≈ R$ 0.
 *   • Chiller CW-5200 = 0,82 kW e exaustor = 0,37 kW (spec Teyu); a fonte do
 *     tubo é estimada em potência_óptica ÷ 0,10 (eficiência típica de tubo DC).
 *     ESTA é a única premissa sem fonte publicada — está na coleção justamente
 *     para o admin corrigir quando alguém medir com alicate amperímetro.
 *
 * `supervisaoPct` não é folheto, é ergonomia: numa galvo de mesa o operador
 * fica junto o tempo todo (peça pequena, troca a cada 30 s → 100%); numa CO2
 * 1300×900 ele carrega a chapa e vai fazer outra coisa (→ 35%).
 */
export const MACHINE_CLASSES: MachineClass[] = [
	{
		id: 'fibra_20',
		label: 'Fibra galvo 20 W',
		laser: 'fibra',
		potenciaW: 20,
		vGravMmS: 1500,
		lineMm: 0.04,
		energiaKw: 0.5,
		gasM3h: 0,
		precoGasM3: 0,
		consumiveisHora: 0,
		manutencaoHora: 0.5,
		valorMaquina: 28000,
		supervisaoPct: 100,
	},
	{
		id: 'fibra_30',
		label: 'Fibra galvo 30 W',
		laser: 'fibra',
		potenciaW: 30,
		vGravMmS: 1900,
		lineMm: 0.04,
		energiaKw: 0.5,
		gasM3h: 0,
		precoGasM3: 0,
		consumiveisHora: 0,
		manutencaoHora: 0.5,
		valorMaquina: 30000,
		supervisaoPct: 100,
	},
	{
		id: 'fibra_50',
		label: 'Fibra galvo 50 W',
		laser: 'fibra',
		potenciaW: 50,
		vGravMmS: 1800,
		lineMm: 0.04,
		energiaKw: 0.6,
		gasM3h: 0,
		precoGasM3: 0,
		consumiveisHora: 0,
		manutencaoHora: 0.5,
		valorMaquina: 32000,
		supervisaoPct: 100,
	},
	{
		id: 'co2_60',
		label: 'CO2 50–60 W (bancada)',
		laser: 'co2',
		potenciaW: 60,
		vGravMmS: 350,
		lineMm: 0.08,
		energiaKw: 1.8,
		gasM3h: 0,
		precoGasM3: 0,
		consumiveisHora: 0.25,
		manutencaoHora: 1,
		valorMaquina: 25900,
		supervisaoPct: 35,
	},
	{
		id: 'co2_80',
		label: 'CO2 80 W',
		laser: 'co2',
		potenciaW: 80,
		vGravMmS: 425,
		lineMm: 0.075,
		energiaKw: 2,
		gasM3h: 0,
		precoGasM3: 0,
		consumiveisHora: 0.25,
		manutencaoHora: 1,
		// Único preço da tabela que saiu de INTERPOLAÇÃO entre a 60 W e a 100 W:
		// nenhuma loja publica o da 80 W (é "sob cotação"). Erra ±20% e o preço
		// final anda 1,5% — mas está na coleção para o admin substituir por um
		// orçamento real assim que tiver um.
		valorMaquina: 28000,
		supervisaoPct: 35,
	},
	{
		id: 'co2_100',
		label: 'CO2 100 W (1300×900)',
		laser: 'co2',
		potenciaW: 100,
		vGravMmS: 350,
		lineMm: 0.08,
		energiaKw: 2.2,
		gasM3h: 0,
		precoGasM3: 0,
		consumiveisHora: 0.25,
		manutencaoHora: 1,
		valorMaquina: 29500,
		supervisaoPct: 35,
	},
	{
		id: 'co2_150',
		label: 'CO2 130–150 W',
		laser: 'co2',
		potenciaW: 150,
		vGravMmS: 500,
		lineMm: 0.07,
		energiaKw: 2.6,
		gasM3h: 0,
		precoGasM3: 0,
		consumiveisHora: 0.3,
		manutencaoHora: 1.2,
		valorMaquina: 54600,
		supervisaoPct: 35,
	},
];

/**
 * "Outra máquina" NÃO é uma classe — é a saída honesta.
 *
 * 13% do parque é UV de 3–5 W, e `LaserKind` só conhece `fibra` e `co2`. Fingir
 * que UV é fibra faria a cascata de velocidade responder com a curva errada e a
 * checagem de material recusar acrílico numa máquina que grava acrílico. Quem
 * escolher esta opção continua com o formulário longo, que nunca deixou de
 * existir — e a ferramenta não mente sobre o que sabe.
 */
export const CLASSE_OUTRA = 'outra';

/** Ids aceitos no campo `maquina_classe` da coleção `perfis`. */
export function machineClassIds(): string[] {
	return [...MACHINE_CLASSES.map((m) => m.id), CLASSE_OUTRA];
}

export function findMachineClass(id: string): MachineClass | undefined {
	return MACHINE_CLASSES.find((m) => m.id === id);
}

/* ──────────────── A classe como COLEÇÃO (`maquinas`, admin) ──────────────── */

/** Campos numéricos da classe: um lugar só, usado pela spec e pelo parser. */
const CAMPOS_MAQUINA = [
	{
		key: 'potenciaW',
		name: 'potencia_w',
		label: 'Potência',
		unit: 'W',
		min: 1,
		max: 20_000,
	},
	{
		key: 'vGravMmS',
		name: 'v_grav_mm_s',
		label: 'Velocidade de gravação',
		unit: 'mm/s',
		min: 1,
		max: 20_000,
	},
	{
		key: 'lineMm',
		name: 'line_mm',
		label: 'Passo de linha',
		unit: 'mm',
		min: 0.005,
		max: 5,
	},
	{
		key: 'vRapidMmS',
		name: 'v_rapid_mm_s',
		label: 'Deslocamento',
		unit: 'mm/s',
		min: 1,
		max: 20_000,
	},
	{
		key: 'energiaKw',
		name: 'energia_kw',
		label: 'Consumo elétrico',
		unit: 'kW',
		min: 0,
		max: 500,
	},
	{
		key: 'gasM3h',
		name: 'gas_m3h',
		label: 'Consumo de gás',
		unit: 'm³/h',
		min: 0,
		max: 1000,
	},
	{
		key: 'precoGasM3',
		name: 'preco_gas_m3',
		label: 'Preço do gás',
		unit: 'R$/m³',
		min: 0,
		max: 10_000,
	},
	{
		key: 'consumiveisHora',
		name: 'consumiveis_hora',
		label: 'Consumíveis por hora',
		unit: 'R$/h',
		min: 0,
		max: 10_000,
	},
	{
		key: 'manutencaoHora',
		name: 'manutencao_hora',
		label: 'Manutenção por hora',
		unit: 'R$/h',
		min: 0,
		max: 10_000,
	},
	{
		key: 'valorMaquina',
		name: 'valor_maquina',
		label: 'Valor da máquina',
		unit: 'R$',
		min: 0,
		max: 10_000_000,
	},
	{
		key: 'supervisaoPct',
		name: 'supervisao_pct',
		label: 'Supervisão durante a máquina',
		unit: '%',
		min: 0,
		max: 100,
	},
] as const satisfies readonly {
	key: keyof MachineClass;
	name: string;
	label: string;
	unit: string;
	min: number;
	max: number;
}[];

/**
 * A coleção `maquinas`: a tabela de referência que o admin edita sem deploy.
 *
 * `visibility: 'public'` e `submissions.who: 'admin'` — é dado de mercado, não
 * segredo de ninguém, e um aluno cadastrando "minha máquina custou R$ 3" viraria
 * padrão para todo mundo. Quem discorda do número não edita a tabela: edita o
 * PRÓPRIO perfil, que é onde o derivado foi gravado.
 */
export function machineFieldsSpec(): CollectionFieldSpec[] {
	const campos: CollectionFieldSpec[] = [
		{
			name: 'classe_id',
			label: 'Id da classe',
			type: 'text',
			required: true,
			placeholder: 'co2_100',
			hint: 'É o que fica gravado no perfil do aluno. Não mude depois de publicado.',
			group: 'Identificação',
		},
		{
			name: 'laser',
			label: 'Tipo de laser',
			type: 'enum',
			required: true,
			options: ['fibra', 'co2'],
			facet: true,
			group: 'Identificação',
		},
	];
	for (const c of CAMPOS_MAQUINA) {
		const padrao = findMachineClass('co2_100')?.[c.key];
		campos.push({
			name: c.name,
			label: c.label,
			type: 'number',
			// Só `classe_id` e `laser` são obrigatórios: a linha da coleção é um
			// PATCH sobre o lastro em código. O admin que só quer corrigir o preço
			// do tubo preenche uma célula, não onze.
			required: false,
			unit: c.unit,
			min: c.min,
			max: c.max,
			...(typeof padrao === 'number' ? { placeholder: String(padrao) } : {}),
			group: 'Custo da hora-máquina',
		});
	}
	return campos;
}

/**
 * Linha da coleção → classe. O lastro em código entra como BASE e cada célula
 * preenchida sobrescreve a sua — é o que faz "corrigir só o preço do tubo" ser
 * uma célula, e não um cadastro inteiro que o admin erraria em outro campo.
 */
export function machineFromCollectionData(
	data: Record<string, unknown>,
	label?: string,
): MachineClass {
	const id = String(data.classe_id ?? '').trim();
	if (!id) throw new ToolEngineError(400, "máquina sem 'classe_id'");
	const base = findMachineClass(id);
	let laser: LaserKind | undefined = base?.laser;
	if (data.laser !== undefined && data.laser !== null && data.laser !== '') {
		const bruto = String(data.laser);
		if (bruto !== 'fibra' && bruto !== 'co2') {
			throw new ToolEngineError(
				400,
				`tipo de laser inválido na máquina '${id}': '${bruto}' (aceito: fibra, co2)`,
			);
		}
		laser = bruto;
	}
	if (!laser) {
		throw new ToolEngineError(
			400,
			`máquina '${id}' não declara o tipo de laser`,
		);
	}
	// Sem lastro em código (classe nova, cadastrada só na coleção) partimos de
	// uma CO2 100 W: é a classe mais bem documentada da tabela, e todo campo que
	// a linha declarar sobrescreve. Uma classe nova sem custo nenhum declarado
	// entrega uma conta que fecha em vez de NaN.
	const referencia = findMachineClass('co2_100') as MachineClass;
	const semente = base ?? { ...referencia, id, laser };
	const out: MachineClass = {
		...semente,
		id,
		laser,
		label: label ?? semente.label,
	};
	const numericos = out as unknown as Record<string, number>;
	for (const c of CAMPOS_MAQUINA) {
		const bruto = data[c.name];
		if (bruto === undefined || bruto === null || bruto === '') continue;
		const n =
			typeof bruto === 'number'
				? bruto
				: Number(String(bruto).replace(',', '.'));
		if (!Number.isFinite(n)) {
			throw new ToolEngineError(
				400,
				`valor não numérico em '${c.name}': '${String(bruto)}'`,
			);
		}
		if (n < c.min || n > c.max) {
			throw new ToolEngineError(
				400,
				`'${c.name}' fora da faixa (${c.min}–${c.max}) na máquina '${id}': ${n}`,
			);
		}
		numericos[c.key] = n;
	}
	return out;
}

/* ─────────────────────────── As seis perguntas ─────────────────────────── */

/**
 * Regime fiscal → imposto sobre a nota (%).
 *
 * A pergunta "quantos por cento de imposto você paga?" não é respondível; "você
 * emite nota?" é. MEI paga DAS FIXO, que não incide sobre a nota — ele entra no
 * overhead, não aqui, e por isso é 0.
 *
 * Fontes: Simples Nacional Anexo III faixa 1 = 6% (serviço, que é o caso de
 * corte e gravação sob encomenda); Anexo I faixa 1 = 4% (comércio, para quem
 * vende produto pronto de prateleira).
 */
export const IMPOSTO_POR_REGIME = {
	sem_nota: 0,
	mei: 0,
	simples_comercio: 4,
	simples_servicos: 6,
} as const;

export type RegimeFiscal = keyof typeof IMPOSTO_POR_REGIME;

export const REGIMES_FISCAIS = Object.keys(
	IMPOSTO_POR_REGIME,
) as RegimeFiscal[];

/**
 * O RÓTULO do regime — a resposta como o dono da oficina a diria.
 *
 * Um lugar só: a tela do perfil, o endpoint `/api/quote/machines` e a
 * `optionLabels` da coleção leem daqui. Cada cópia a mais é uma chance de a
 * mesma opção aparecer como "simples_servicos" numa tela e "Serviço" na outra.
 */
export const LABEL_REGIME: Record<RegimeFiscal, string> = {
	sem_nota: 'Não emito nota',
	mei: 'MEI (DAS fixo por mês)',
	simples_comercio: 'Simples Nacional — comércio (4%)',
	simples_servicos: 'Simples Nacional — serviço (6%)',
};

/** Por que o imposto é aquele — em uma linha, na tela, sem sigla solta. */
const TEXTO_REGIME: Record<RegimeFiscal, string> = {
	sem_nota: 'sem nota, não há imposto sobre a venda',
	mei: 'o MEI paga DAS fixo por mês, que não incide sobre a nota (ele entra no overhead)',
	simples_comercio: 'Simples Nacional, Anexo I (comércio), primeira faixa',
	simples_servicos: 'Simples Nacional, Anexo III (serviço), primeira faixa',
};

/** As seis respostas. Tudo opcional: cada ausência cai num padrão declarado. */
export interface RespostasCurtas {
	/** 1 — "Que máquina você tem?" */
	maquinaClasse?: string;
	/** 2 — "Quantas horas por dia você trabalha com ela?" */
	horasUteisDia?: number;
	/** 3 — "Quanto você quer ganhar por mês?" (R$) */
	ganhoMensal?: number;
	/** 4 — "Quanto você quer lucrar em cima do custo?" (%, escala da coleção) */
	markupPct?: number;
	/** 5 — "Você emite nota?" */
	regimeFiscal?: RegimeFiscal;
	/** 6 — "Qual o menor valor que você aceita cobrar por um pedido?" (R$) */
	pedidoMinimo?: number;
}

/**
 * Padrões das seis perguntas quando o aluno pula alguma.
 *
 * `GANHO_MENSAL_PADRAO` de R$ 4.400 é o que dá R$ 25/h em 8 h × 22 dias — o
 * mesmo R$ 25/h que o perfil padrão sempre usou, agora dito na língua de quem
 * responde. Para efeito de comparação: salário mínimo 2026 = R$ 1.621 (Decreto
 * 12.797/2025), que com encargos ×1,7 em 176 h dá R$ 15,66/h de FUNCIONÁRIO.
 * O dono-operador, que é o caso normal aqui, cobra a hora dele, não a do CLT.
 */
export const HORAS_UTEIS_PADRAO = 8;
export const GANHO_MENSAL_PADRAO = 4400;
export const MARKUP_PADRAO_PCT = 100;
export const PEDIDO_MINIMO_PADRAO = 50;
export const REGIME_PADRAO: RegimeFiscal = 'simples_servicos';

/** Dias trabalhados por mês (22 = 5 dias × 52 semanas ÷ 12, arredondado). */
export const DIAS_UTEIS_MES = 22;

/**
 * Anos de vida da máquina.
 *
 * IN RFB 1700/2017, anexo III: máquinas e equipamentos depreciam a 10% ao ano,
 * ou seja 10 anos. `vida_util_h` deixa de ser um campo inrespondível e vira
 * consequência de quanto o aluno trabalha — que ele sabe de cabeça.
 */
export const VIDA_ANOS = 10;

/**
 * Preço do kWh.
 *
 * Média nacional ≈ R$ 0,68; Neoenergia Brasília B1 homologada R$ 0,827; RJ
 * R$ 1,47; RS R$ 0,41. R$ 0,85 fica na faixa alta do centro — errar isto em 30%
 * move o preço final 2,2%, então não vira pergunta. O padrão antigo era 0,95.
 */
export const PRECO_KWH_PADRAO = 0.85;

/* ─────────────────────────── A derivação ─────────────────────────── */

/** De onde saiu um valor do perfil. É isto que a tela mostra ao lado do campo. */
export type OrigemDoValor = 'resposta' | 'maquina' | 'calculo' | 'padrao';

export interface CampoDerivado {
	/** Nome do campo na coleção `perfis`. */
	campo: string;
	label: string;
	valor: string | number;
	unidade?: string;
	origem: OrigemDoValor;
	/** Em português, para a tela: "padrão para CO2 100 W". */
	fonte: string;
}

export interface PerfilDerivado {
	/** Registro COMPLETO da coleção `perfis` — todo campo preenchido. */
	data: Record<string, unknown>;
	/** O que foi assumido, campo a campo, com a origem. */
	assumidos: CampoDerivado[];
	maquina: MachineClass | null;
}

function r6(n: number): number {
	return Math.round(n * 1e6) / 1e6;
}

/**
 * SEIS RESPOSTAS → OS 31 CAMPOS.
 *
 * Função PURA e sem I/O, como todo o resto do dinheiro nesta ferramenta: quem
 * busca a linha da coleção `maquinas` é o bloco `quote.perfil_padrao`, e ele
 * entrega a classe já resolvida aqui. Assim a derivação inteira é testável sem
 * banco, e a tabela de mercado continua editável sem deploy.
 *
 * O retorno é um registro COMPLETO da coleção — nenhum campo em branco. Ver o
 * cabeçalho do arquivo: branco herda o padrão de fibra 1500 W e cobra +46% sem
 * avisar. E o que foi assumido volta em `assumidos`, para a tela poder dizer de
 * onde cada número veio e oferecer o lápis.
 */
export function derivarPerfilCurto(
	respostas: RespostasCurtas,
	maquinaResolvida?: MachineClass | null,
): PerfilDerivado {
	const classeId = respostas.maquinaClasse?.trim() || CLASSE_OUTRA;
	const maquina =
		maquinaResolvida ??
		(classeId === CLASSE_OUTRA ? null : (findMachineClass(classeId) ?? null));
	if (classeId !== CLASSE_OUTRA && !maquina) {
		throw new ToolEngineError(
			400,
			`máquina '${classeId}' não está na tabela (aceito: ${machineClassIds().join(', ')})`,
		);
	}

	const horas = respostas.horasUteisDia ?? HORAS_UTEIS_PADRAO;
	const ganho = respostas.ganhoMensal ?? GANHO_MENSAL_PADRAO;
	const markup = respostas.markupPct ?? MARKUP_PADRAO_PCT;
	const regime = respostas.regimeFiscal ?? REGIME_PADRAO;
	const minimo = respostas.pedidoMinimo ?? PEDIDO_MINIMO_PADRAO;

	if (horas <= 0 || horas > 24) {
		throw new ToolEngineError(
			400,
			`horas por dia fora da faixa (0–24): ${horas}`,
		);
	}
	if (ganho < 0)
		throw new ToolEngineError(400, `ganho mensal negativo: ${ganho}`);
	if (markup < 0)
		throw new ToolEngineError(400, `lucro sobre o custo negativo: ${markup}`);

	const data: Record<string, unknown> = {};
	const assumidos: CampoDerivado[] = [];
	const doPadrao = maquina
		? `padrão para ${maquina.label}`
		: 'padrão do sistema';

	const põe = (
		campo: string,
		label: string,
		valor: string | number,
		origem: OrigemDoValor,
		fonte: string,
		unidade?: string,
	) => {
		data[campo] = valor;
		// A resposta do aluno não é "assumida" — ele acabou de digitar. A lista é
		// o que a tela precisa JUSTIFICAR, e justificar o que a pessoa respondeu
		// é ruído que faz ela parar de ler as justificativas que importam.
		if (origem !== 'resposta') {
			assumidos.push({
				campo,
				label,
				valor,
				origem,
				fonte,
				...(unidade ? { unidade } : {}),
			});
		}
	};

	/* ── 1. A máquina responde por 12 campos ─────────────────────────────── */
	if (maquina) {
		põe('maquina_classe', 'Máquina', maquina.id, 'resposta', 'você escolheu');
		põe('laser', 'Tipo de laser', maquina.laser, 'maquina', doPadrao);
		põe('potencia_w', 'Potência', maquina.potenciaW, 'maquina', doPadrao, 'W');
		põe(
			'v_grav_mm_s',
			'Velocidade de gravação',
			maquina.vGravMmS,
			'maquina',
			`mediana medida por quem tem ${maquina.label}`,
			'mm/s',
		);
		põe(
			'line_mm',
			'Passo de linha',
			maquina.lineMm,
			'maquina',
			`mediana medida por quem tem ${maquina.label}`,
			'mm',
		);
		põe(
			'energia_kw',
			'Consumo elétrico',
			maquina.energiaKw,
			'maquina',
			doPadrao,
			'kW',
		);
		põe(
			'gas_m3h',
			'Consumo de gás',
			maquina.gasM3h,
			'maquina',
			maquina.gasM3h === 0
				? 'esta máquina não usa gás de assistência'
				: doPadrao,
			'm³/h',
		);
		põe(
			'preco_gas_m3',
			'Preço do gás',
			maquina.precoGasM3,
			'maquina',
			maquina.gasM3h === 0 ? 'sem gás, sem preço de gás' : doPadrao,
			'R$/m³',
		);
		põe(
			'consumiveis_hora',
			'Consumíveis por hora',
			maquina.consumiveisHora,
			'maquina',
			maquina.laser === 'co2'
				? 'tubo de ~R$ 2.000 a cada 8.000 h de uso'
				: 'fonte de fibra dura ~100.000 h: sem consumível relevante',
			'R$/h',
		);
		põe(
			'manutencao_hora',
			'Manutenção por hora',
			maquina.manutencaoHora,
			'maquina',
			doPadrao,
			'R$/h',
		);
		põe(
			'valor_maquina',
			'Valor da máquina',
			maquina.valorMaquina,
			'maquina',
			`preço de mercado da ${maquina.label}`,
			'R$',
		);
		põe(
			'supervisao_pct',
			'Supervisão durante a máquina',
			maquina.supervisaoPct,
			'maquina',
			maquina.supervisaoPct >= 100
				? 'peça pequena, troca a toda hora: você fica junto o tempo todo'
				: 'você carrega a chapa e vai fazer outra coisa enquanto corta',
			'%',
		);
		if (maquina.vRapidMmS !== undefined) {
			põe(
				'v_rapid_mm_s',
				'Deslocamento',
				maquina.vRapidMmS,
				'maquina',
				doPadrao,
				'mm/s',
			);
		}
	} else {
		põe('maquina_classe', 'Máquina', CLASSE_OUTRA, 'resposta', 'você escolheu');
	}

	/* ── 2. Horas por dia: uma resposta, três campos ──────────────────────── */
	põe(
		'horas_uteis_dia',
		'Horas úteis por dia',
		horas,
		'resposta',
		'você respondeu',
		'h',
	);
	const vidaUtilH = Math.round(horas * DIAS_UTEIS_MES * 12 * VIDA_ANOS);
	põe(
		'vida_util_h',
		'Vida útil da máquina',
		vidaUtilH,
		'calculo',
		`${horas} h/dia × ${DIAS_UTEIS_MES} dias × 12 meses × ${VIDA_ANOS} anos (depreciação de 10% ao ano, IN RFB 1700)`,
		'h',
	);

	/* ── 3. Ganho mensal → a hora do dono ─────────────────────────────────── */
	põe(
		'ganho_mensal',
		'Quanto quer ganhar por mês',
		ganho,
		'resposta',
		'você respondeu',
		'R$',
	);
	const horaOperador = r6(ganho / (horas * DIAS_UTEIS_MES));
	põe(
		'custo_hora_operador',
		'Custo/hora do operador',
		horaOperador,
		'calculo',
		`R$ ${ganho.toLocaleString('pt-BR')} por mês ÷ (${horas} h × ${DIAS_UTEIS_MES} dias)`,
		'R$/h',
	);

	/* ── 4. Lucro sobre o custo: markup manda, margem é consequência ──────── */
	põe(
		'markup_pct',
		'Markup sobre o custo',
		markup,
		'resposta',
		'você respondeu',
		'%',
	);
	// margem = markup / (1 + markup). São a MESMA decisão em duas escalas, e
	// confundir "3× o custo" com "35% de margem" é a origem clássica de quebrar
	// preço. Perguntar as duas era pedir para o aluno se contradizer; agora ele
	// responde uma e vê a outra.
	const margem = r6((markup / (100 + markup)) * 100);
	põe(
		'margem_pct',
		'Margem sobre a venda',
		margem,
		'calculo',
		`${markup}% de lucro sobre o custo é o mesmo que ${margem.toFixed(1)}% de margem sobre a venda`,
		'%',
	);
	põe(
		'precificar_por',
		'Fechar preço por',
		'markup',
		'calculo',
		'você respondeu em lucro sobre o custo, então é por markup que o preço fecha',
	);

	/* ── 5. Nota fiscal → imposto ─────────────────────────────────────────── */
	põe(
		'regime_fiscal',
		'Você emite nota?',
		regime,
		'resposta',
		'você respondeu',
	);
	const imposto = IMPOSTO_POR_REGIME[regime];
	põe(
		'imposto_pct',
		'Imposto sobre a nota',
		imposto,
		'calculo',
		TEXTO_REGIME[regime],
		'%',
	);

	/* ── 6. Pedido mínimo ─────────────────────────────────────────────────── */
	// É a pergunta que MAIS decide o preço do trabalho típico deste público:
	// gravar um logo num copo, 1 peça, dá R$ 8,00 de preço calculado e R$ 50,00
	// de preço cobrado. Nesse trabalho os outros 30 campos movem 0,00%.
	põe(
		'pedido_minimo',
		'Pedido mínimo',
		minimo,
		'resposta',
		'você respondeu',
		'R$',
	);

	/* ── O resto: padrão declarado, revisável, gravado ────────────────────── */
	põe(
		'preco_kwh',
		'Preço do kWh',
		PRECO_KWH_PADRAO,
		'padrao',
		'média das tarifas do país (varia de R$ 0,41 no RS a R$ 1,47 no RJ)',
		'R$',
	);
	põe(
		'ineficiencia_pct',
		'Ineficiência (aceleração/cantos)',
		15,
		'padrao',
		'a máquina não corta na velocidade cheia o tempo todo: acelera, freia e vira nos cantos',
		'%',
	);
	põe(
		'setup_min',
		'Preparação por pedido',
		5,
		'padrao',
		'abrir o arquivo, fixar a chapa, focar e alinhar',
		'min',
	);
	põe(
		'tempo_manual_min',
		'Trabalho manual por peça',
		0,
		'padrao',
		'isto é fato do TRABALHO, não da oficina: pergunte a cada orçamento',
		'min',
	);
	põe(
		'acabamento_por_peca',
		'Acabamento por peça',
		0,
		'padrao',
		'isto é fato do TRABALHO, não da oficina: pergunte a cada orçamento',
		'R$',
	);
	põe(
		'overhead_pct',
		'Overhead (aluguel, luz, admin)',
		20,
		'padrao',
		'aluguel, internet, contador e o que mais roda mesmo com a máquina parada',
		'%',
	);
	põe(
		'arredondamento',
		'Arredondamento do preço',
		'0.50',
		'padrao',
		'preço fecha nos 50 centavos para cima — nunca para baixo do custo',
	);
	põe(
		'prazo_base_dias',
		'Prazo base',
		2,
		'padrao',
		'a folga que você dá antes de começar a peça',
		'dias',
	);
	põe(
		'material_basis',
		'Como cobrar o material',
		'bbox',
		'padrao',
		'cobra o retângulo que a peça ocupa na chapa: o retalho de dentro fica com você',
	);
	põe(
		'aproveitamento_pct',
		'Aproveitamento da chapa',
		75,
		'padrao',
		'quanto da chapa vira peça quando você cobra por chapa',
		'%',
	);
	põe(
		'descontos',
		'Descontos por quantidade',
		'',
		'padrao',
		'em branco = você não dá desconto automático por quantidade',
	);

	return { data, assumidos, maquina };
}
