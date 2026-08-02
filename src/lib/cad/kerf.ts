/**
 * Compensação de kerf e geometria de encaixes.
 *
 * O feixe do laser não é uma linha: ele remove uma faixa de largura `k`
 * CENTRADA no traço do desenho. Logo, a peça pronta nunca tem a medida
 * desenhada — cada fronteira anda k/2 para dentro do material. Todo o resto
 * deste arquivo é consequência disso.
 *
 * Vocabulário usado nas assinaturas:
 * - "desenhado" = o que vai no DXF/SVG;
 * - "final" = o que sai da máquina, depois de o feixe comer k.
 *
 * Módulo PURO: só Node built-ins e `tool-errors`. Nada que leia env no topo.
 */

import { ToolEngineError } from '../tool-errors.js';

/** Passo/dente-alvo aceitos: abaixo de 6 mm o dente esfarela, acima de 25 mm o encaixe folga. */
export const DENTE_ALVO_MIN = 6;
export const DENTE_ALVO_MAX = 25;

/** Folga (clearance) fora desta faixa deixa de ser ajuste e vira erro de projeto. */
export const FOLGA_MIN = -0.2;
export const FOLGA_MAX = 0.5;

function round12(v: number): number {
	// Corta o lixo de ponto flutuante que a soma/divisão introduz, sem mexer em
	// nada que a máquina consiga enxergar (1e-12 mm).
	return Math.round(v * 1e12) / 1e12;
}

// ---------------------------------------------------------------------------
// As três compensações
// ---------------------------------------------------------------------------

/**
 * Dimensão EXTERNA: o material fica DENTRO da linha (contorno da peça, dente
 * do encaixe). O feixe come k/2 de cada lado → desenhe k a mais.
 */
export function outer(nominal: number, k: number): number {
	return round12(nominal + k);
}

/**
 * Dimensão INTERNA: o material SAI (furo, fenda, rasgo). O feixe alarga o vazio
 * em k/2 de cada lado → desenhe k a menos.
 */
export function inner(nominal: number, k: number): number {
	return round12(nominal - k);
}

/**
 * Fronteira ÚNICA material/vazio (profundidade de uma fenda, aresta solta).
 * Só metade do feixe está do lado que interessa → k/2.
 * Para o lado do VAZIO use `nominal - k/2` (ver `fendaProf` e `crossLap`).
 */
export function edge(nominal: number, k: number): number {
	return round12(nominal + k / 2);
}

export function holeDiameter(d: number, k: number): number {
	// Furo é vazio: desenhar d entrega d + k. Para sair d, desenha-se d − k.
	return inner(d, k);
}

// ---------------------------------------------------------------------------
// Finger joint
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}

/**
 * Número de dentes numa aresta de comprimento `L`.
 * SEMPRE ÍMPAR: com número ímpar a peça macho começa e termina em DENTE, o que
 * fecha os dois cantos da caixa com material (par deixaria um canto em fenda,
 * abrindo um rasgo visível na quina).
 */
export function fingerCount(L: number, alvo: number): number {
	const a = clamp(alvo, DENTE_ALVO_MIN, DENTE_ALVO_MAX);
	return 2 * Math.floor(L / (2 * a)) + 1;
}

export interface FingerParams {
	/** Comprimento da aresta a dentar. */
	L: number;
	/** Espessura DESTA chapa (a que recebe a fenda). */
	t: number;
	/** Espessura da chapa OPOSTA (a que o dente atravessa). */
	tOposta: number;
	/** Kerf. */
	k: number;
	/** Folga de montagem (positiva = encaixe solto). */
	c: number;
	/** Dente-alvo desejado; default max(3t, 8), sempre limitado a [6, 25]. */
	alvo?: number;
}

export interface FingerGeometry {
	n: number;
	/** Passo real (L / n). */
	p: number;
	/** Largura DESENHADA do dente. */
	denteLargura: number;
	/** Largura DESENHADA da fenda. */
	fendaLargura: number;
	/** Altura DESENHADA do dente (atravessa a chapa oposta e fica rente). */
	denteAltura: number;
	/** Profundidade DESENHADA da fenda. */
	fendaProf: number;
	/** Largura FINAL do dente, já descontado o kerf. */
	denteLarguraFinal: number;
	/** Largura FINAL da fenda, já alargada pelo kerf. */
	fendaLarguraFinal: number;
	/** Dente-alvo efetivamente usado (após default e clamp). */
	alvoUsado: number;
}

/**
 * Geometria de um finger joint. O contrato é
 * `fendaLarguraFinal − denteLarguraFinal === c`: o dente é material (perde k),
 * a fenda é vazio (ganha k), então o desenho embute 2k de correção — por isso
 * as larguras DESENHADAS diferem de `c − 2k`, e não de `c`. Confundir as duas
 * é o erro clássico que produz caixa que não fecha.
 */
export function fingerGeometry(params: FingerParams): FingerGeometry {
	const { L, t, tOposta, k, c } = params;
	const alvoUsado = clamp(
		params.alvo ?? Math.max(3 * t, 8),
		DENTE_ALVO_MIN,
		DENTE_ALVO_MAX,
	);
	const n = fingerCount(L, alvoUsado);
	const p = L / n;
	const denteLargura = round12(p - c / 2 + k);
	const fendaLargura = round12(p + c / 2 - k);
	return {
		n,
		p: round12(p),
		denteLargura,
		fendaLargura,
		denteAltura: outer(tOposta, k),
		// Fundo da fenda é fronteira única do lado do VAZIO: nominal − k/2.
		fendaProf: round12(t - k / 2),
		denteLarguraFinal: round12(denteLargura - k),
		fendaLarguraFinal: round12(fendaLargura + k),
		alvoUsado,
	};
}

// ---------------------------------------------------------------------------
// Cross lap (encaixe em cruz / meia-madeira)
// ---------------------------------------------------------------------------

export interface CrossLapParams {
	/** Espessura da chapa que vai ENTRAR neste rasgo. */
	tOutra: number;
	k: number;
	c: number;
	/** Altura total da região de sobreposição — cada peça recebe metade. */
	H: number;
}

export interface CrossLapResult {
	/** Largura DESENHADA do rasgo. */
	slotLarg: number;
	/** Profundidade DESENHADA do rasgo. */
	slotProf: number;
	/** Largura FINAL do rasgo (deve dar tOutra + c). */
	slotLargFinal: number;
	/** Profundidade FINAL do rasgo (deve dar H/2). */
	slotProfFinal: number;
}

/**
 * Duas peças que se cruzam: cada uma ganha um rasgo de meia altura e elas
 * deslizam uma na outra. O rasgo é vazio nas duas laterais (−k) e vazio no
 * fundo (fronteira única, −k/2).
 */
export function crossLap(params: CrossLapParams): CrossLapResult {
	const { tOutra, k, c, H } = params;
	const slotLarg = inner(tOutra + c, k);
	const slotProf = round12(H / 2 - k / 2);
	return {
		slotLarg,
		slotProf,
		slotLargFinal: round12(slotLarg + k),
		slotProfFinal: round12(slotProf + k / 2),
	};
}

// ---------------------------------------------------------------------------
// Invariantes
// ---------------------------------------------------------------------------

export interface JointValidationParams {
	/** Espessura desta chapa. */
	t: number;
	/** Kerf. */
	k: number;
	/** Folga. */
	c: number;
	/** Passo do encaixe, se já calculado. */
	p?: number;
	/** Comprimento da aresta — usado só para avisar quando não cabe nenhum dente. */
	L?: number;
	/** Nº de dentes, se já calculado. */
	n?: number;
	/** Diâmetros NOMINAIS de furos a validar. */
	furos?: number[];
}

export interface JointValidation {
	fatal: string[];
	warnings: string[];
}

const mm = (v: number): string => `${Math.round(v * 1000) / 1000} mm`;

/**
 * Checa as invariantes do encaixe. `fatal` deve virar erro 400 (peça
 * impossível); `warnings` acompanha o resultado como aviso ao aluno.
 * Mensagens dizem o que FAZER, não só o que está errado.
 */
export function validateJoint(params: JointValidationParams): JointValidation {
	const { t, k, c } = params;
	const fatal: string[] = [];
	const warnings: string[] = [];

	if (!(t > 0))
		fatal.push(
			`Espessura inválida (${mm(t)}). Informe a espessura real da chapa.`,
		);
	if (!(k >= 0))
		fatal.push(`Kerf inválido (${mm(k)}). O kerf não pode ser negativo.`);

	// Kerf >= espessura significa que o feixe é mais largo que a chapa: não
	// existe dente possível, o material vira pó antes de virar encaixe.
	if (t > 0 && k >= t) {
		fatal.push(
			`O kerf (${mm(k)}) é maior ou igual à espessura da chapa (${mm(t)}). ` +
				'Reduza o kerf (foco/potência) ou use uma chapa mais grossa.',
		);
	}

	const p = params.p;
	if (p !== undefined) {
		const dente = p - c / 2 + k;
		if (dente <= 0) {
			fatal.push(
				`O dente ficaria com largura ${mm(dente)} (zero ou negativa). ` +
					'Aumente o dente-alvo, reduza a folga ou reduza o kerf.',
			);
		}
		const passoMin = Math.max(2 * t, 5);
		if (p < passoMin) {
			warnings.push(
				`Passo do encaixe (${mm(p)}) menor que o mínimo recomendado (${mm(passoMin)}). ` +
					'Aumente o dente-alvo: dentes muito curtos quebram na montagem.',
			);
		}
		if (k > 0 && p < 3 * k) {
			warnings.push(
				`Passo do encaixe (${mm(p)}) menor que 3× o kerf (${mm(3 * k)}). ` +
					'O feixe come quase todo o dente — aumente o dente-alvo ou reduza o kerf.',
			);
		}
	}

	if (c < FOLGA_MIN || c > FOLGA_MAX) {
		warnings.push(
			`Folga de ${mm(c)} fora da faixa usual (${mm(FOLGA_MIN)} a ${mm(FOLGA_MAX)}). ` +
				(c > FOLGA_MAX
					? 'O encaixe vai ficar bailando; reduza a folga.'
					: 'O encaixe vai ficar forçado demais; aumente a folga.'),
		);
	}

	if (params.n !== undefined && params.n < 3) {
		warnings.push(
			`A aresta comporta apenas ${params.n} dente(s)${
				params.L !== undefined ? ` em ${mm(params.L)}` : ''
			}. Reduza o dente-alvo para o encaixe travar de verdade.`,
		);
	}

	for (const d of params.furos ?? []) {
		const final = d - k;
		if (final <= 0.5) {
			fatal.push(
				`Furo de ${mm(d)} some com o kerf (sobraria ${mm(final)}). ` +
					'Aumente o diâmetro do furo para pelo menos ' +
					`${mm(k + 0.5)} ou reduza o kerf.`,
			);
		}
	}

	return { fatal, warnings };
}

/** Atalho: valida e já lança 400 se houver invariante fatal. Devolve os avisos. */
export function assertJoint(params: JointValidationParams): string[] {
	const { fatal, warnings } = validateJoint(params);
	if (fatal.length > 0) throw new ToolEngineError(400, fatal.join(' '));
	return warnings;
}
