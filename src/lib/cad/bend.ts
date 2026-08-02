/**
 * Planificação de chapa dobrada (sheet metal unfolding).
 *
 * Quando uma peça sai de UMA chapa plana e as arestas viram linhas de dobra
 * (layer `DOBRA`, nunca `CORTE`), a soma das faces NÃO é o comprimento da
 * planificação: ao dobrar, a face externa estica e a interna comprime. Só a
 * "fibra neutra" — a k·t de profundidade a partir da face interna — conserva o
 * comprimento. Todo este arquivo existe para descontar a diferença.
 *
 * Vocabulário (o mesmo de `kerf.ts`):
 * - "desenhado" = o que vai no DXF/SVG, antes de o feixe comer o kerf;
 * - "final" = a medida da peça depois de cortada.
 * Aqui entra um terceiro eixo: a medida DESENVOLVIDA (chapa plana) versus a
 * medida da peça DOBRADA. Não confunda com kerf — são compensações diferentes e
 * ambas se aplicam à mesma peça.
 *
 * Módulo PURO: só Node built-ins, `kerf` (tipos) e `tool-errors`. Nada que leia
 * env no topo.
 */

import { ToolEngineError } from '../tool-errors.js';
import type { JointValidation } from './kerf.js';

// ---------------------------------------------------------------------------
// Materiais
// ---------------------------------------------------------------------------

export type BendMaterial = 'aco_carbono' | 'inox_304' | 'aluminio' | 'corten';

/**
 * Fator K: posição da fibra neutra medida da face INTERNA, em frações da
 * espessura. 0,5 seria o meio da chapa (só acontece em raio muito generoso);
 * quanto mais fechado o raio, mais a fibra neutra migra para dentro.
 * Valores de tabela de dobradeira para dobra a 90° com raio próximo de t.
 */
export const K_FACTOR: Record<BendMaterial, number> = {
	aco_carbono: 0.38,
	inox_304: 0.45,
	aluminio: 0.33,
	corten: 0.38,
};

/**
 * Raio interno mínimo, em múltiplos da espessura. Abaixo disso a face externa
 * ultrapassa o alongamento do material e TRINCA na dobra.
 * Aço carbono aceita raio fechado (0,5·t); inox 304 encrua e exige raio cheio;
 * alumínio (mesmo recozido) e corten trincam com facilidade — 1,0·t é o piso
 * conservador aqui. Ligas duras (6061-T6) pedem mais que isso: quando houver
 * dúvida, aumente o raio.
 */
const RAIO_MIN_FATOR: Record<BendMaterial, number> = {
	aco_carbono: 0.5,
	inox_304: 1.0,
	aluminio: 1.0,
	corten: 1.0,
};

export function isBendMaterial(v: string): v is BendMaterial {
	return Object.hasOwn(K_FACTOR, v);
}

/** Raio interno mínimo em mm para o material e a espessura dados. */
export function minBendRadius(material: BendMaterial, t: number): number {
	if (!isBendMaterial(material)) {
		throw new ToolEngineError(
			400,
			`Material de dobra desconhecido: "${String(material)}". ` +
				`Use um destes: ${Object.keys(K_FACTOR).join(', ')}.`,
		);
	}
	return round12(RAIO_MIN_FATOR[material] * t);
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function round12(v: number): number {
	// Mesmo motivo de `kerf.ts`: tira o lixo de ponto flutuante sem mexer em
	// nada que a máquina enxergue (1e-12 mm).
	return Math.round(v * 1e12) / 1e12;
}

const mm = (v: number): string => `${Math.round(v * 1000) / 1000} mm`;

/** Tolerância de comparação: evita reprovar um valor exatamente no limite. */
const EPS = 1e-9;

function exigeGeometria(theta: number, r: number, t: number, K: number): void {
	if (!Number.isFinite(theta) || theta <= 0 || theta >= 180) {
		throw new ToolEngineError(
			400,
			`Ângulo de dobra inválido (${String(theta)}°). ` +
				'Informe o ângulo VARRIDO pela dobra, entre 0 e 180 graus ' +
				'(dobra reta = 90°). Dobra de 180° é rebordo (hem) e tem cálculo próprio.',
		);
	}
	if (!Number.isFinite(t) || t <= 0) {
		throw new ToolEngineError(
			400,
			`Espessura inválida (${String(t)}). Informe a espessura real da chapa.`,
		);
	}
	if (!Number.isFinite(r) || r < 0) {
		throw new ToolEngineError(
			400,
			`Raio interno inválido (${String(r)}). O raio não pode ser negativo.`,
		);
	}
	if (!Number.isFinite(K) || K <= 0 || K > 0.5) {
		throw new ToolEngineError(
			400,
			`Fator K inválido (${String(K)}). O fator K fica entre 0 e 0,5 — ` +
				'0,5 é a fibra neutra no meio da chapa, o limite físico.',
		);
	}
}

// ---------------------------------------------------------------------------
// Bend allowance / bend deduction
// ---------------------------------------------------------------------------

/**
 * Bend allowance: comprimento de chapa CONSUMIDO pelo arco da dobra, medido na
 * fibra neutra (raio r + K·t).
 *
 *   BA(θ, r, t, K) = (π/180) · θ · (r + K·t)
 *
 * É o arco de raio da fibra neutra varrendo θ. `theta` em GRAUS.
 */
export function bendAllowance(
	theta: number,
	r: number,
	t: number,
	K: number,
): number {
	exigeGeometria(theta, r, t, K);
	return round12((Math.PI / 180) * theta * (r + K * t));
}

/**
 * Bend deduction: quanto SUBTRAIR da soma das faces EXTERNAS para achar a chapa
 * plana.
 *
 *   BD(θ, r, t, K) = 2·(r + t)·tan(θ·π/360) − BA
 *
 * O primeiro termo é o dobro do setback (OSSB): a distância do ponto de
 * tangência até o vértice teórico onde as duas faces externas se cruzariam. Medir
 * face externa até o vértice conta esse trecho DUAS vezes; o arco real é BA. A
 * diferença é o que sobra de material se você planificar somando as faces.
 */
export function bendDeduction(
	theta: number,
	r: number,
	t: number,
	K: number,
): number {
	const ba = bendAllowance(theta, r, t, K);
	// tan(θ·π/360) === tan(θ/2 em radianos): metade do ângulo varrido.
	const setback = (r + t) * Math.tan((theta * Math.PI) / 360);
	return round12(2 * setback - ba);
}

// ---------------------------------------------------------------------------
// Comprimento desenvolvido
// ---------------------------------------------------------------------------

export interface BendSpec {
	/** Ângulo VARRIDO pela dobra, em graus (dobra reta = 90). */
	angulo: number;
	/** Raio INTERNO da dobra, em mm. */
	raio: number;
	/** Espessura da chapa, em mm. */
	espessura: number;
	/** Fator K do material (use `K_FACTOR[material]`). */
	fatorK: number;
}

/**
 * Comprimento desenvolvido de uma CADEIA de faces ligadas por dobras:
 *
 *   L = Σ(faces externas) − Σ BD
 *
 * `faces` são medidas EXTERNAS (de vértice teórico a vértice teórico, que é o
 * que se lê no desenho da peça pronta) e `bends` são as dobras ENTRE elas — daí
 * a exigência `bends.length === faces.length − 1`. Uma bandeja de 4 dobras não é
 * uma cadeia só: são duas cadeias cruzadas (uma por eixo), cada uma com 2
 * dobras, e a chapa é o retângulo dos dois desenvolvidos.
 */
export function developedLength(faces: number[], bends: BendSpec[]): number {
	if (faces.length === 0) {
		throw new ToolEngineError(
			400,
			'A planificação precisa de pelo menos uma face.',
		);
	}
	if (bends.length !== faces.length - 1) {
		throw new ToolEngineError(
			400,
			`Cadeia de dobras inconsistente: ${faces.length} face(s) exigem ` +
				`${faces.length - 1} dobra(s), mas vieram ${bends.length}. ` +
				'As dobras ficam ENTRE as faces.',
		);
	}
	let total = 0;
	for (const face of faces) {
		if (!Number.isFinite(face) || face <= 0) {
			throw new ToolEngineError(
				400,
				`Face de ${String(face)} mm na planificação. Toda face precisa ser ` +
					'um número maior que zero.',
			);
		}
		total += face;
	}
	for (const b of bends) {
		total -= bendDeduction(b.angulo, b.raio, b.espessura, b.fatorK);
	}
	if (total <= 0) {
		throw new ToolEngineError(
			400,
			`A planificação daria ${mm(total)}: as dobras consomem mais material que ` +
				'as faces. Aumente as faces ou reduza o raio das dobras.',
		);
	}
	return round12(total);
}

// ---------------------------------------------------------------------------
// Alívio de canto
// ---------------------------------------------------------------------------

export interface CornerReliefParams {
	/** Espessura da chapa. */
	t: number;
	/** Kerf do corte. */
	k: number;
	/** Raio interno da dobra. */
	r: number;
}

export interface CornerRelief {
	/** Largura FINAL do entalhe (o vão que sobra depois de cortado): t + k. */
	largura: number;
	/** Profundidade FINAL do entalhe, medida da aresta para dentro: r + t. */
	profundidade: number;
	/** Largura DESENHADA — o entalhe é vazio, o feixe o alarga em k. */
	larguraDesenhada: number;
	/** Profundidade DESENHADA — fundo do entalhe é fronteira única: −k/2. */
	profundidadeDesenhada: number;
	/** Raio FINAL do fundo arredondado (entalhe obround): metade da largura. */
	raioFundo: number;
	/** Raio DESENHADO do fundo. */
	raioFundoDesenhado: number;
}

/**
 * Alívio de canto: o entalhe OBRIGATÓRIO no ponto onde duas linhas de dobra se
 * encontram.
 *
 * Sem ele, o canto é material que precisaria esticar em duas direções ao mesmo
 * tempo — a chapa RASGA na dobra, e é o erro que destrói a peça (não tem
 * conserto depois de dobrada). O entalhe some com esse material antes da
 * dobradeira encostar.
 *
 * Dimensões: largura `t + k` (precisa vencer a própria espessura da aba
 * vizinha) e profundidade `r + t`, que é exatamente o setback de uma dobra de
 * 90° — menos que isso e o entalhe termina DENTRO da zona deformada, que é o
 * mesmo que não existir.
 *
 * Fundo arredondado, nunca canto vivo: canto vivo em região que vai deformar é
 * concentrador de tensão, ou seja, o ponto por onde a trinca começa.
 */
export function cornerRelief(params: CornerReliefParams): CornerRelief {
	const { t, k, r } = params;
	if (!Number.isFinite(t) || t <= 0) {
		throw new ToolEngineError(
			400,
			`Espessura inválida (${String(t)}) para o alívio de canto.`,
		);
	}
	if (!Number.isFinite(k) || k < 0) {
		throw new ToolEngineError(
			400,
			`Kerf inválido (${String(k)}). O kerf não pode ser negativo.`,
		);
	}
	if (!Number.isFinite(r) || r < 0) {
		throw new ToolEngineError(
			400,
			`Raio interno inválido (${String(r)}) para o alívio de canto.`,
		);
	}
	const largura = round12(t + k);
	const profundidade = round12(r + t);
	return {
		largura,
		profundidade,
		larguraDesenhada: round12(largura - k),
		profundidadeDesenhada: round12(profundidade - k / 2),
		raioFundo: round12(largura / 2),
		raioFundoDesenhado: round12((largura - k) / 2),
	};
}

// ---------------------------------------------------------------------------
// Invariantes da dobra
// ---------------------------------------------------------------------------

export interface BendValidationParams {
	/** Espessura da chapa. */
	t: number;
	/** Raio interno da dobra. */
	r: number;
	/** Material (define fator K e raio mínimo). */
	material: BendMaterial;
	/** Menor aba (flange) que sai desta dobra. Omita para não checar. */
	flange?: number;
	/** Distância do furo mais próximo até a linha de dobra. Omita para não checar. */
	furoDist?: number;
}

/**
 * Invariantes de dobra. `fatal` deve virar erro 400 (peça que não sai da
 * dobradeira ou que racha); `warnings` acompanha o resultado como aviso.
 *
 * As três regras clássicas de chão de fábrica:
 * - aba mínima `4t + r`: a aba precisa apoiar nos dois ombros da matriz V. Mais
 *   curta que isso ela cai dentro do canal e simplesmente não dobra — FATAL;
 * - raio mínimo do material: abaixo dele a face externa trinca — FATAL;
 * - furo a `2,5t + r` da linha de dobra: dentro desse raio o material escoa e o
 *   furo redondo sai OVAL. A peça ainda sai, com defeito, e a saída é furar
 *   depois de dobrar — AVISO.
 */
export function validateBend(params: BendValidationParams): JointValidation {
	const { t, r, material } = params;
	const fatal: string[] = [];
	const warnings: string[] = [];

	const tOk = Number.isFinite(t) && t > 0;
	const rOk = Number.isFinite(r) && r >= 0;
	if (!tOk) {
		fatal.push(
			`Espessura inválida (${String(t)}). Informe a espessura real da chapa.`,
		);
	}
	if (!rOk) {
		fatal.push(
			`Raio interno inválido (${String(r)}). O raio não pode ser negativo.`,
		);
	}

	if (!isBendMaterial(material)) {
		fatal.push(
			`Material de dobra desconhecido: "${String(material)}". ` +
				`Use um destes: ${Object.keys(K_FACTOR).join(', ')}.`,
		);
	} else if (tOk && rOk) {
		// Raio mínimo depende do material; sem material a checagem não existe, mas
		// as duas geométricas abaixo continuam valendo.
		const rMin = minBendRadius(material, t);
		if (r < rMin - EPS) {
			fatal.push(
				`Raio interno de ${mm(r)} abaixo do mínimo de ${material} ` +
					`(${mm(rMin)} para chapa de ${mm(t)}). A face externa trinca na dobra — ` +
					'aumente o raio (matriz V mais aberta) ou troque o material.',
			);
		}
	}

	if (!tOk || !rOk) return { fatal, warnings };

	const flange = params.flange;
	if (flange !== undefined) {
		const flangeMin = round12(4 * t + r);
		if (!Number.isFinite(flange) || flange < flangeMin - EPS) {
			fatal.push(
				`Aba de ${mm(flange)} menor que a mínima dobrável ` +
					`(4·espessura + raio = ${mm(flangeMin)}). A aba não apoia nos ombros ` +
					'da matriz V: ela não dobra. Aumente a aba ou use matriz mais estreita.',
			);
		}
	}

	const furoDist = params.furoDist;
	if (furoDist !== undefined) {
		const furoMin = round12(2.5 * t + r);
		if (!Number.isFinite(furoDist) || furoDist < furoMin - EPS) {
			warnings.push(
				`Furo a ${mm(furoDist)} da linha de dobra, abaixo do mínimo ` +
					`(2,5·espessura + raio = ${mm(furoMin)}). O material escoa e o furo sai ` +
					'oval. Afaste o furo da dobra ou fure depois de dobrar.',
			);
		}
	}

	return { fatal, warnings };
}
