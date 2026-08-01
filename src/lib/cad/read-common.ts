/**
 * Peças comuns aos leitores de arquivo (DXF e SVG): diagnóstico, classificação
 * de layer e o fechamento do `Sketch2D`.
 *
 * O diagnóstico não é enfeite: é o que a UI usa para dizer ao profissional
 * "achei 3 textos que não vão ser cortados", "a unidade foi deduzida", "ignorei
 * 12 hachuras". Leitor de arquivo de campo ERRA — o que não se pode é errar
 * calado dentro de um orçamento.
 *
 * Módulo PURO: `./ir.js`, `./units.js`, `./xform.js` e built-ins.
 */

import {
	bboxOf,
	type CadPath,
	computeStats,
	type LayerId,
	type Sketch2D,
} from './ir.js';
import type { UnitsResolution } from './units.js';
import { translateSeg } from './xform.js';

export interface CadReadDiagnostics {
	formato: 'dxf' | 'svg';
	unidade: UnitsResolution;
	/** Caixa envolvente ANTES da conversão de unidade, em unidades do arquivo. */
	bboxOriginal: { w: number; h: number };
	/** Quantas entidades de cada tipo foram convertidas em geometria. */
	lidas: Record<string, number>;
	/** Quantas de cada tipo foram ignoradas (hachura, cota, sólido...). */
	ignoradas: Record<string, number>;
	/** Textos encontrados — não são vetorizados, então não têm custo de corte. */
	textos: number;
	/** Layers que entram no corte/gravação. */
	layersUsadas: string[];
	/** Layers reconhecidas como auxiliares (cota, construção): fora do corte. */
	layersAuxiliares: string[];
	/** Blocos (INSERT) expandidos, contando repetição de arranjo. */
	blocosExpandidos: number;
	/** Blocos que se referenciam em ciclo — detectados e cortados, não travam. */
	blocosCiclicos: string[];
	/** Total de pontos gerados por tesselação (peso do preview). */
	pontosTesselados: number;
	/** Tolerância de corda usada, em mm. */
	epsMm: number;
}

/** Segmentos de geometria (não-texto) somam custo; texto nunca. */
const RE_AUX = /^(dim|cota|texto|text|anota|constru|aux|defpoints)/i;
const RE_GRAV = /^(grav|engrav|scan|raster)/i;
const RE_MARCA = /^(marca|mark|centro|center)/i;
const RE_DOBRA = /^(dobra|bend|fold|vinco|score)/i;

/**
 * Traduz o nome da layer do arquivo para a camada da IR.
 * `aux: true` = não entra no comprimento de corte (vai para REFERENCIA, que
 * `computeStats` ignora de propósito), mas continua no desenho e no relatório.
 */
export function classifyLayer(nome: string | undefined | null): {
	layer: LayerId;
	aux: boolean;
} {
	const n = (nome ?? '').trim();
	if (RE_AUX.test(n)) return { layer: 'REFERENCIA', aux: true };
	if (RE_GRAV.test(n)) return { layer: 'GRAVACAO', aux: false };
	if (RE_DOBRA.test(n)) return { layer: 'DOBRA', aux: false };
	if (RE_MARCA.test(n)) return { layer: 'MARCACAO', aux: false };
	return { layer: 'CORTE', aux: false };
}

export function bump(mapa: Record<string, number>, chave: string, n = 1): void {
	mapa[chave] = (mapa[chave] ?? 0) + n;
}

export interface FinalizeInput {
	paths: CadPath[];
	generator: string;
	label: string;
	diag: CadReadDiagnostics;
	warnings: string[];
	params?: Record<string, unknown>;
}

/**
 * Fecha o `Sketch2D` do arquivo lido: leva a geometria para a origem
 * (minX = minY = 0, que é o que `rotatePath90`/nesting pressupõem), mede a caixa
 * e roda as estatísticas determinísticas.
 */
export function finalizeSketch(input: FinalizeInput): Sketch2D {
	const bb = bboxOf(input.paths);
	const paths =
		Math.abs(bb.minX) < 1e-12 && Math.abs(bb.minY) < 1e-12
			? input.paths
			: input.paths.map((p) => ({
					...p,
					seg: translateSeg(p.seg, -bb.minX, -bb.minY),
				}));
	const part = {
		id: 'arquivo',
		label: input.label,
		thickness: 0,
		material: '',
		paths,
		bbox: { w: bb.w, h: bb.h },
		qty: 1,
	};
	return {
		units: 'mm' as const,
		schema: 1 as const,
		parts: [part],
		meta: {
			generator: input.generator,
			params: { ...(input.params ?? {}), diagnostico: input.diag },
			kerf: 0,
			clearance: 0,
			warnings: input.warnings,
			stats: computeStats([part]),
		},
	};
}

/** Recupera o diagnóstico de um sketch produzido por `readDxf`/`readSvg`. */
export function readDiagnostics(
	sketch: Sketch2D,
): CadReadDiagnostics | undefined {
	const d = sketch.meta.params?.diagnostico;
	return d && typeof d === 'object' ? (d as CadReadDiagnostics) : undefined;
}
