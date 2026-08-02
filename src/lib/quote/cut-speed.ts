/**
 * VELOCIDADE DE CORTE — a ponte entre o orçamento e o Metallic.
 *
 * O tempo de máquina é a metade do preço de um trabalho a laser, e ele depende
 * de um número que ninguém tem de cabeça: quantos mm/s aquele material naquela
 * espessura corta naquela máquina. Este módulo resolve isso em CASCATA e devolve
 * SEMPRE a confiança do que devolveu:
 *
 *   1. coleção curada de velocidades  → `curated`,   confiança 1,00
 *   2. mediana da comunidade          → `community`, confiança 0,70
 *   3. curva paramétrica v = k/esp^n  → `modelo`,    confiança 0,40
 *
 * A confiança é DADO DE SAÍDA obrigatório: abaixo de `CONFIANCA_MINIMA_OK` a
 * tela precisa dizer "estimativa, confirme antes de fechar o preço". Preço
 * calculado sobre número inventado, sem aviso, é pior que não ter a ferramenta —
 * o profissional fecha o pedido e descobre o erro na hora de cortar.
 *
 * Módulo PURO e sem I/O: as fontes entram por INJEÇÃO (`sources`). Quem busca na
 * coleção e em `pl_parameter` é o bloco da Fábrica, não esta função.
 */

import { ToolEngineError } from '../tool-errors.js';
import { normalizeMaterialKey } from './materials.js';

export type LaserKind = 'fibra' | 'co2';

export type CutSpeedSource = 'manual' | 'curated' | 'community' | 'modelo';

/** Confiança abaixo disto = a tela obriga a confirmar antes de fechar preço. */
export const CONFIANCA_MINIMA_OK = 0.7;

export const CONFIANCA = {
	/** O profissional digitou a velocidade: é a máquina dele. */
	manual: 1,
	/** Linha curada com a espessura exata e potência compatível. */
	curada: 1,
	/** Curada, mas espessura vizinha ou potência convertida. */
	curadaAjustada: 0.85,
	/** Mediana da comunidade com amostras suficientes. */
	comunidade: 0.7,
	/** Uma ou duas amostras: é a opinião de um aluno, não uma mediana. */
	comunidadePoucas: 0.55,
	/** Curva paramétrica. */
	modelo: 0.4,
} as const;

/** Amostras mínimas para a mediana da comunidade valer 0,7. */
export const MIN_AMOSTRAS_COMUNIDADE = 3;

/** Tolerância de espessura para considerar a linha "a mesma" (mm). */
const TOL_ESP_MM = 0.01;
/** Distância relativa máxima de espessura aceita numa linha vizinha. */
const TOL_ESP_REL = 0.25;
/** Distância relativa de potência aceita sem conversão. */
const TOL_POT_REL = 0.25;

/**
 * Teto de velocidade útil (mm/s). A curva é uma hipérbole: em 0,3 mm ela cospe
 * milhares de mm/s, que a dinâmica do pórtico não entrega em contorno real.
 */
export const VELOCIDADE_MAX_MM_S = 600;
/** Abaixo disto, a espessura provavelmente está acima da capacidade da máquina. */
const VELOCIDADE_SUSPEITA_MM_S = 3;

/* ─────────────────────────── Entradas ─────────────────────────── */

export interface CutSpeedInput {
	/** Família do material ("aço carbono", "mdf"), como na coleção `materiais`. */
	familia: string;
	espessuraMm: number;
	laser: LaserKind;
	/** Potência ÓPTICA da máquina, em W. */
	potenciaW: number;
	/** Override do profissional: vence a cascata inteira. */
	speedMmS?: number;
	passes?: number;
	pierceS?: number;
}

/** Linha da coleção curada de velocidades (já filtrada pelo bloco). */
export interface CuratedSpeedRow {
	espessuraMm: number;
	speedMmS: number;
	passes?: number;
	pierceS?: number;
	/** Potência em que a linha foi medida. Ausente = assume a da máquina. */
	potenciaW?: number;
	familia?: string;
	laser?: LaserKind;
	fonte?: string;
}

/**
 * Linha vinda da comunidade (`pl_parameter`). O bloco converte antes de injetar:
 * em `pl_parameter` a espessura é `thickness` **string** ("3", "3mm", "1,2") e a
 * potência aparece em % (`power`) e/ou em W (`powerWatts`) — normalizar isso é
 * trabalho de quem lê o banco, não desta função.
 */
export interface CommunitySpeedRow {
	espessuraMm: number;
	speedMmS: number;
	passes?: number;
	potenciaW?: number;
}

export interface CutSpeedSources {
	curated?: CuratedSpeedRow[];
	community?: CommunitySpeedRow[];
}

export interface CutSpeedResult {
	speedMmS: number;
	passes: number;
	pierceS: number;
	source: CutSpeedSource;
	confidence: number;
	/** `true` = a tela precisa pedir confirmação antes de fechar o preço. */
	estimativa: boolean;
	/** Quantas linhas entraram na mediana (só em `community`). */
	amostras?: number;
	avisos: string[];
	/** Como o número foi obtido, em uma linha, para auditoria na tela. */
	detalhe: string;
}

/* ─────────────────────── Curvas paramétricas ─────────────────────── */

interface Curva {
	laser: LaserKind;
	/** v(esp) = k / esp^n, com k referido a `pRef`. */
	k: number;
	n: number;
	pRef: number;
}

/**
 * Curvas por família. `k` calibrado por relatos de máquina de praça
 * (fibra 1500 W, CO2 100 W) e `n` pelo regime físico: em metal com fibra a
 * velocidade cai um pouco MAIS QUE linearmente com a espessura (n≈1,15, e mais
 * ainda em material reflexivo), enquanto em MDF/acrílico com CO2 cai um pouco
 * MENOS que linearmente (n≈0,9) porque o corte é por vaporização e o próprio
 * canal ajuda a conduzir o feixe.
 *
 * Isto é o TERCEIRO nível da cascata: existe para nunca deixar o profissional
 * sem número, e sai marcado com confiança 0,4 justamente porque é modelo.
 */
const CURVAS: Record<string, Curva[]> = {
	'aço carbono': [{ laser: 'fibra', k: 130, n: 1.15, pRef: 1500 }],
	galvanizado: [{ laser: 'fibra', k: 125, n: 1.15, pRef: 1500 }],
	'inox 304': [{ laser: 'fibra', k: 110, n: 1.2, pRef: 1500 }],
	'inox 430': [{ laser: 'fibra', k: 112, n: 1.2, pRef: 1500 }],
	alumínio: [{ laser: 'fibra', k: 100, n: 1.25, pRef: 1500 }],
	latão: [{ laser: 'fibra', k: 75, n: 1.3, pRef: 1500 }],
	cobre: [{ laser: 'fibra', k: 70, n: 1.3, pRef: 1500 }],
	titânio: [{ laser: 'fibra', k: 105, n: 1.15, pRef: 1500 }],
	zinco: [{ laser: 'fibra', k: 95, n: 1.2, pRef: 1500 }],
	mdf: [{ laser: 'co2', k: 45, n: 0.9, pRef: 100 }],
	'mdf cru': [{ laser: 'co2', k: 47, n: 0.9, pRef: 100 }],
	compensado: [{ laser: 'co2', k: 40, n: 0.95, pRef: 100 }],
	acrílico: [{ laser: 'co2', k: 60, n: 0.9, pRef: 100 }],
	couro: [{ laser: 'co2', k: 90, n: 0.8, pRef: 100 }],
	eva: [{ laser: 'co2', k: 120, n: 0.8, pRef: 100 }],
	papelão: [{ laser: 'co2', k: 100, n: 0.85, pRef: 100 }],
	borracha: [{ laser: 'co2', k: 30, n: 0.9, pRef: 100 }],
	// Sem curva de propósito: PVC libera cloro, policarbonato e ABS derretem em
	// vez de cortar. Quem tentar orçar recebe erro em vez de um preço plausível
	// para um trabalho que não se faz.
};

/**
 * Índice de `CURVAS` com a chave NORMALIZADA (sem acento, minúscula).
 *
 * As chaves acima estão em PT-BR com acento porque é assim que a família chega
 * da coleção `materiais`; a busca, porém, é feita sobre a chave normalizada — sem
 * este índice, `aço carbono` viraria `aco carbono` na consulta e NENHUMA família
 * acentuada acharia curva (o orçamento morria com "sem velocidade de corte").
 */
const INDICE_CURVAS: Record<string, Curva[]> = (() => {
	const idx: Record<string, Curva[]> = {};
	for (const [familia, curvas] of Object.entries(CURVAS)) {
		idx[normalizeMaterialKey(familia)] = curvas;
	}
	return idx;
})();

/**
 * Escala de potência: k = k_ref · (P/P_ref)^0,7.
 *
 * O expoente 0,7 (e não 1) porque dobrar a potência NÃO dobra a velocidade:
 * parte do ganho vai em largura de corte, escória e limite do gás de assistência.
 */
export function escalaPotencia(potenciaW: number, pRef: number): number {
	if (!(potenciaW > 0) || !(pRef > 0)) return 1;
	return (potenciaW / pRef) ** 0.7;
}

/** `pierceS` de fallback: tempo para o feixe abrir o furo antes de andar. */
export function pierceFallbackS(espessuraMm: number, laser: LaserKind): number {
	// Em CO2 (acrílico/MDF) não existe perfuração como no metal, mas existe o
	// atraso de abertura do canal + rampa de potência — a constante absorve isso.
	return laser === 'fibra' ? 0.2 + 0.35 * espessuraMm : 0.5 + 0.2 * espessuraMm;
}

/** Mediana. NÃO é média: um parâmetro absurdo de um aluno não move a mediana. */
export function mediana(valores: number[]): number {
	if (valores.length === 0) return Number.NaN;
	const v = [...valores].sort((a, b) => a - b);
	const meio = Math.floor(v.length / 2);
	return v.length % 2 === 1 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

/* ─────────────────────────── Cascata ─────────────────────────── */

function potenciaCompativel(rowW: number | undefined, alvoW: number): boolean {
	if (rowW === undefined || !(rowW > 0)) return true; // linha sem potência: aceita
	return Math.abs(rowW - alvoW) / alvoW <= TOL_POT_REL;
}

function converteParaPotencia(
	speedMmS: number,
	rowW: number | undefined,
	alvoW: number,
): number {
	if (rowW === undefined || !(rowW > 0)) return speedMmS;
	return speedMmS * escalaPotencia(alvoW, rowW);
}

function finaliza(
	r: Omit<CutSpeedResult, 'estimativa' | 'avisos'> & { avisos?: string[] },
): CutSpeedResult {
	const avisos = [...(r.avisos ?? [])];
	let speedMmS = r.speedMmS;

	if (!(speedMmS > 0) || !Number.isFinite(speedMmS)) {
		throw new ToolEngineError(
			500,
			`velocidade de corte inválida (${r.speedMmS} mm/s) — bug na cascata de velocidade`,
		);
	}
	if (speedMmS > VELOCIDADE_MAX_MM_S) {
		avisos.push(
			`velocidade limitada a ${VELOCIDADE_MAX_MM_S} mm/s: acima disso a máquina não sustenta o contorno`,
		);
		speedMmS = VELOCIDADE_MAX_MM_S;
	}
	if (speedMmS < VELOCIDADE_SUSPEITA_MM_S) {
		avisos.push(
			'velocidade muito baixa: confira se essa espessura está dentro da capacidade da máquina',
		);
	}
	const estimativa = r.confidence < CONFIANCA_MINIMA_OK;
	if (estimativa) {
		avisos.push(
			'velocidade é ESTIMATIVA — confirme num corte de teste antes de fechar o preço',
		);
	}
	return {
		...r,
		speedMmS,
		passes: Math.max(1, Math.round(r.passes)),
		estimativa,
		avisos,
	};
}

/**
 * Resolve velocidade/passadas/perfuração em cascata, com a confiança de cada
 * nível. `sources` é injetado: o bloco da Fábrica é que consulta a coleção
 * curada e a comunidade.
 */
export function resolveCutSpeed(
	input: CutSpeedInput,
	sources: CutSpeedSources = {},
): CutSpeedResult {
	const { espessuraMm, laser, potenciaW } = input;
	if (!(espessuraMm > 0)) {
		throw new ToolEngineError(
			400,
			`espessura inválida para velocidade de corte: ${espessuraMm} mm`,
		);
	}
	if (!(potenciaW > 0)) {
		throw new ToolEngineError(
			400,
			`potência do laser inválida: ${potenciaW} W (preencha a potência no seu perfil)`,
		);
	}
	const pierceFallback = pierceFallbackS(espessuraMm, laser);

	// Nível 0 — o profissional digitou. Ninguém sabe mais da máquina dele.
	if (input.speedMmS !== undefined && input.speedMmS > 0) {
		return finaliza({
			speedMmS: input.speedMmS,
			passes: input.passes ?? 1,
			pierceS: input.pierceS ?? pierceFallback,
			source: 'manual',
			confidence: CONFIANCA.manual,
			detalhe: `velocidade informada pelo profissional (${input.speedMmS} mm/s)`,
		});
	}

	const familiaNorm = normalizeMaterialKey(input.familia ?? '');

	// Nível 1 — coleção curada.
	const curadas = (sources.curated ?? []).filter(
		(r) =>
			r.speedMmS > 0 &&
			r.espessuraMm > 0 &&
			(r.laser === undefined || r.laser === laser) &&
			(r.familia === undefined ||
				normalizeMaterialKey(r.familia) === familiaNorm),
	);
	if (curadas.length > 0) {
		// Mais próxima em espessura; empate desempatado pela potência mais próxima.
		const melhor = [...curadas].sort((a, b) => {
			const da = Math.abs(a.espessuraMm - espessuraMm);
			const db = Math.abs(b.espessuraMm - espessuraMm);
			if (Math.abs(da - db) > TOL_ESP_MM) return da - db;
			return (
				Math.abs((a.potenciaW ?? potenciaW) - potenciaW) -
				Math.abs((b.potenciaW ?? potenciaW) - potenciaW)
			);
		})[0];

		const dEsp = Math.abs(melhor.espessuraMm - espessuraMm);
		const espExata = dEsp <= TOL_ESP_MM;
		const potOk = potenciaCompativel(melhor.potenciaW, potenciaW);
		const dentroDaFaixa = dEsp / espessuraMm <= TOL_ESP_REL;

		if (espExata || dentroDaFaixa) {
			const avisos: string[] = [];
			if (!espExata) {
				avisos.push(
					`sem linha curada em ${espessuraMm} mm: usando a de ${melhor.espessuraMm} mm`,
				);
			}
			if (!potOk) {
				avisos.push(
					`linha medida em ${melhor.potenciaW} W, convertida para ${potenciaW} W`,
				);
			}
			const speedMmS = potOk
				? melhor.speedMmS
				: converteParaPotencia(melhor.speedMmS, melhor.potenciaW, potenciaW);
			return finaliza({
				speedMmS,
				passes: melhor.passes ?? 1,
				pierceS: melhor.pierceS ?? input.pierceS ?? pierceFallback,
				source: 'curated',
				confidence:
					espExata && potOk ? CONFIANCA.curada : CONFIANCA.curadaAjustada,
				detalhe: `coleção curada${melhor.fonte ? ` (${melhor.fonte})` : ''}: ${melhor.espessuraMm} mm → ${speedMmS.toFixed(1)} mm/s`,
				avisos,
			});
		}
	}

	// Nível 2 — mediana da comunidade. Só linhas de espessura próxima: dado de
	// aluno em 6 mm não diz nada sobre 1 mm.
	const proximas = (sources.community ?? []).filter(
		(r) =>
			r.speedMmS > 0 &&
			r.espessuraMm > 0 &&
			Math.abs(r.espessuraMm - espessuraMm) / espessuraMm <= 0.15,
	);
	if (proximas.length > 0) {
		const velocidades = proximas.map((r) =>
			converteParaPotencia(r.speedMmS, r.potenciaW, potenciaW),
		);
		const speedMmS = mediana(velocidades);
		const comPasses = proximas
			.map((r) => r.passes)
			.filter((p): p is number => typeof p === 'number' && p > 0);
		const poucas = proximas.length < MIN_AMOSTRAS_COMUNIDADE;
		return finaliza({
			speedMmS,
			passes: comPasses.length > 0 ? Math.round(mediana(comPasses)) : 1,
			pierceS: input.pierceS ?? pierceFallback,
			source: 'community',
			confidence: poucas ? CONFIANCA.comunidadePoucas : CONFIANCA.comunidade,
			amostras: proximas.length,
			detalhe: `mediana de ${proximas.length} parâmetro(s) da comunidade → ${speedMmS.toFixed(1)} mm/s`,
			avisos: poucas
				? [
						`só ${proximas.length} parâmetro(s) da comunidade nessa espessura: a mediana ainda não filtra outlier`,
					]
				: [],
		});
	}

	// Nível 3 — curva paramétrica.
	const curvas = INDICE_CURVAS[familiaNorm];
	if (!curvas || curvas.length === 0) {
		throw new ToolEngineError(
			400,
			`sem velocidade de corte para '${input.familia}': cadastre uma linha na coleção de velocidades ou informe a velocidade manualmente`,
		);
	}
	const curva = curvas.find((c) => c.laser === laser);
	if (!curva) {
		throw new ToolEngineError(
			400,
			`'${input.familia}' não é material de laser ${laser} — confira o material ou informe a velocidade manualmente`,
		);
	}
	const k = curva.k * escalaPotencia(potenciaW, curva.pRef);
	const speedMmS = k / espessuraMm ** curva.n;
	return finaliza({
		speedMmS,
		passes: input.passes ?? 1,
		pierceS: input.pierceS ?? pierceFallback,
		source: 'modelo',
		confidence: CONFIANCA.modelo,
		detalhe: `curva v = ${k.toFixed(1)} / esp^${curva.n} (referência ${curva.pRef} W → ${potenciaW} W) → ${speedMmS.toFixed(1)} mm/s`,
	});
}

/** Famílias com curva paramétrica, para a tela avisar o que ela cobre. */
export function familiasComCurva(): { familia: string; laser: LaserKind }[] {
	return Object.entries(CURVAS).flatMap(([familia, cs]) =>
		cs.map((c) => ({ familia, laser: c.laser })),
	);
}
