/**
 * Resolução de unidade de arquivo CAD.
 *
 * ERRO DE UNIDADE É ERRO DE PREÇO POR 25×: o mesmo desenho lido como polegada ou
 * como milímetro muda peso, área e tempo de máquina por 25,4 em cada eixo. É o
 * modo de falha mais caro do leitor — por isso este módulo NUNCA esconde o que
 * fez: sempre devolve `detected` (para a UI pré-marcar no seletor) e, quando não
 * teve certeza, um `warning` para o profissional confirmar.
 *
 * Módulo PURO: só built-ins.
 */

export type UnitName = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'px';

export type UnitsSource = 'insunits' | 'heuristica' | 'hint' | 'svg';

/** Fator de conversão para milímetro de cada unidade suportada. */
export const UNIT_TO_MM: Record<UnitName, number> = {
	mm: 1,
	cm: 10,
	m: 1000,
	in: 25.4,
	ft: 304.8,
	// 1 px CSS = 1/96 in. Só aparece em SVG sem unidade declarada.
	px: 25.4 / 96,
};

/**
 * Códigos do `$INSUNITS` do header do DXF que interessam a corte a laser.
 * 0 = sem unidade (o AutoCAD não sabe; muito comum em arquivo de terceiro).
 */
const INSUNITS: Record<number, UnitName> = {
	1: 'in',
	2: 'ft',
	4: 'mm',
	5: 'cm',
	6: 'm',
};

/**
 * Limites da heurística de plausibilidade, em unidades do arquivo:
 * - abaixo de 25: peça de laser de 20 unidades é 20 POLEGADAS (~500 mm), não
 *   20 mm — ninguém desenha chaveiro de 20 mm inteiros num arquivo só;
 * - 25 a 3000: faixa da chapa de laser (a maior mesa comum é 1300×2500 mm);
 * - acima de 3000: ambíguo (pode ser mm de peça grande ou desenho em outra
 *   unidade); mantém mm e AVISA, porque converter no escuro é pior.
 */
export const HEUR_MIN_MM = 25;
export const HEUR_MAX_MM = 3000;

export interface ResolveUnitsInput {
	/** Valor do `$INSUNITS` do DXF, se houver. */
	insunits?: number | null;
	/** Caixa envolvente do desenho, em unidades do próprio arquivo. */
	bbox?: { w: number; h: number } | null;
	/** Unidade escolhida à mão pelo profissional na UI — manda em tudo. */
	hint?: UnitName | null;
}

export interface UnitsResolution {
	/** Multiplique cada coordenada do arquivo por isto para obter mm. */
	factorToMm: number;
	source: UnitsSource;
	/** Unidade concluída — a UI pré-marca esta no seletor. */
	detected: UnitName;
	/** Presente sempre que a conclusão NÃO é confiável. Mostre ao usuário. */
	warning?: string;
}

/**
 * Decide a unidade do arquivo. Precedência: `hint` (escolha humana) >
 * `$INSUNITS` (declaração do arquivo) > heurística pela bbox (chute explícito).
 */
export function resolveUnits(input: ResolveUnitsInput): UnitsResolution {
	const { insunits, bbox, hint } = input;

	if (hint && hint in UNIT_TO_MM) {
		return {
			factorToMm: UNIT_TO_MM[hint],
			source: 'hint',
			detected: hint,
		};
	}

	const code =
		typeof insunits === 'number' && Number.isFinite(insunits)
			? Math.round(insunits)
			: null;

	if (code !== null && code !== 0) {
		const u = INSUNITS[code];
		if (u) {
			return { factorToMm: UNIT_TO_MM[u], source: 'insunits', detected: u };
		}
		// Código válido no padrão, mas fora do que corte a laser usa (milha,
		// micropolegada...). Cai na heurística em vez de aplicar fator absurdo.
		const h = heuristica(bbox);
		return {
			...h,
			warning: `$INSUNITS=${code} não é unidade usada em corte (mm, cm, m, in, ft). ${h.warning ?? `Assumido ${h.detected}.`} Confirme a unidade.`,
		};
	}

	const h = heuristica(bbox);
	return {
		...h,
		warning:
			h.warning ??
			`Arquivo sem $INSUNITS; unidade deduzida pelo tamanho (${h.detected}). Confirme antes de fechar o orçamento.`,
	};
}

function heuristica(bbox?: { w: number; h: number } | null): UnitsResolution {
	const maxDim = bbox ? Math.max(Number(bbox.w) || 0, Number(bbox.h) || 0) : 0;

	if (!(maxDim > 0)) {
		return {
			factorToMm: 1,
			source: 'heuristica',
			detected: 'mm',
			warning:
				'Desenho sem dimensão mensurável; assumido milímetro. Confirme a unidade.',
		};
	}
	if (maxDim < HEUR_MIN_MM) {
		return {
			factorToMm: UNIT_TO_MM.in,
			source: 'heuristica',
			detected: 'in',
			warning: `Desenho tem só ${round2(maxDim)} unidades de lado; em mm seria uma peça minúscula, então foi lido como POLEGADA (${round2(maxDim * 25.4)} mm). Confirme a unidade.`,
		};
	}
	if (maxDim > HEUR_MAX_MM) {
		return {
			factorToMm: 1,
			source: 'heuristica',
			detected: 'mm',
			warning: `Desenho tem ${round2(maxDim)} unidades de lado, acima de qualquer mesa de laser. Mantido em milímetro, mas a unidade é ambígua — confirme.`,
		};
	}
	return { factorToMm: 1, source: 'heuristica', detected: 'mm' };
}

function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

/** Converte um comprimento com sufixo de unidade CSS/SVG para mm. `null` se não reconhecer. */
export function cssLengthToMm(raw: string | null | undefined): number | null {
	if (!raw) return null;
	const m = /^\s*([+-]?[\d.]+(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(raw);
	if (!m) return null;
	const v = Number(m[1]);
	if (!Number.isFinite(v)) return null;
	const u = m[2].toLowerCase();
	switch (u) {
		case '':
		case 'px':
			return v * UNIT_TO_MM.px;
		case 'mm':
			return v;
		case 'cm':
			return v * 10;
		case 'm':
			return v * 1000;
		case 'in':
			return v * 25.4;
		case 'pt':
			return (v * 25.4) / 72;
		case 'pc':
			return (v * 25.4) / 6;
		case 'q':
			return v / 4;
		default:
			// %, em, rem, vw... dependem de contexto que não existe aqui.
			return null;
	}
}

/** `true` quando o comprimento traz unidade FÍSICA declarada (mm/cm/in/pt/...). */
export function hasPhysicalUnit(raw: string | null | undefined): boolean {
	if (!raw) return false;
	return /[\d.\s](mm|cm|m|in|pt|pc|q)\s*$/i.test(raw);
}
