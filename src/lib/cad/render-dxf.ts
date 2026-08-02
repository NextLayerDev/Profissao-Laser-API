/**
 * Exportador DXF do motor CAD: `Sketch2D` (+ nesting opcional) → texto DXF
 * R2007 pronto para LightBurn, RDWorks, EZCAD e afins.
 *
 * Módulo PURO: só `ir`, `tool-errors` e a lib de DXF. Nada que leia env no topo.
 *
 * Diferenciação de operação é por LAYER + COR, nunca por linetype: LightBurn e
 * EZCAD importam o DXF ignorando o linetype e casam a camada pela cor/nome, e
 * é assim que o aluno atribui potência/velocidade a cada layer.
 */

import {
	Colors,
	DxfWriter,
	LWPolylineFlags,
	point2d,
	point3d,
	TextHorizontalAlignment,
	Units,
} from '@tarikjabiri/dxf';
import { ToolEngineError } from '../tool-errors.js';
import {
	bboxOf,
	type CadPath,
	EPS,
	LAYER_IDS,
	type LayerId,
	type NestResult,
	type Part,
	rect,
	rotatePath90,
	type Sketch2D,
	translatePath,
} from './ir.js';

/**
 * Cor ACI de cada layer. É o único canal de diferenciação que todo controlador
 * de laser entende. ACI 8 (cinza escuro) não tem constante em `Colors`.
 */
export const LAYER_COLOR_ACI: Record<LayerId, number> = {
	CORTE: Colors.Red,
	GRAVACAO: Colors.Blue,
	MARCACAO: Colors.Green,
	DOBRA: Colors.Magenta,
	REFERENCIA: 8,
};

/** Espaço entre peças no arranjo de fallback (sem nesting), em mm. */
const GAP_PADRAO = 10;

/**
 * Espaço entre chapas quando o nesting devolve mais de uma. Cada chapa é um
 * setup de máquina diferente; separá-las evita que o aluno mande cortar duas
 * chapas de uma vez achando que é um desenho só.
 */
const GAP_CHAPAS = 50;

export interface DxfOptions {
	/**
	 * Desenha o retângulo da chapa. Default FALSE de propósito: com a chapa no
	 * arquivo a máquina corta a borda dela — perde tempo, queima o batente e
	 * pode soltar a peça no meio do job.
	 */
	incluirChapa?: boolean;
	/** Espaço entre peças no arranjo sem nesting (default 10 mm). */
	gap?: number;
}

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

/**
 * Arredonda para 6 casas (1 nm). Não é preciosismo: `String(1e-16)` em JS sai
 * como `"1e-16"`, e leitor de DXF antigo lê notação exponencial como 0 ou
 * aborta o arquivo. Arredondar mata o lixo de ponto flutuante antes de virar
 * texto. `-0` também é normalizado (imprimiria "-0").
 */
function n(v: number, casas = 6): number {
	const f = 10 ** casas;
	const r = Math.round(v * f) / f;
	return Object.is(r, -0) ? 0 : r;
}

/** Radianos → graus em [0, 360). O DXF guarda ângulo de arco em GRAUS. */
function grau(rad: number): number {
	const d = (rad * 180) / Math.PI;
	return n(((d % 360) + 360) % 360);
}

// ---------------------------------------------------------------------------
// Montagem da lista de caminhos em coordenadas de chapa
// ---------------------------------------------------------------------------

/** Quantidade efetiva de uma peça (mesma regra de `computeStats`). */
function qtyDe(part: Part): number {
	return Math.max(0, Math.round(part.qty));
}

function mover(paths: CadPath[], dx: number, dy: number): CadPath[] {
	if (dx === 0 && dy === 0) return paths;
	return paths.map((p) => translatePath(p, dx, dy));
}

/**
 * Traz a peça para a origem local (minX = minY = 0) e devolve a caixa MEDIDA.
 *
 * `ir.ts` declara isso como pré-condição dos geradores, e `rotatePath90` e o
 * nesting contam com ela. Medir aqui em vez de confiar no `part.bbox` fecha duas
 * portas: a de um gerador que esqueceu de normalizar (a peça sairia deslocada do
 * ponto que o nesting reservou) e a de um `part.bbox` desatualizado em relação
 * aos `paths` (a rotação de 90° usa a altura para refletir — altura errada joga
 * a peça girada para fora da chapa). É a mesma normalização que `render-svg.ts`
 * faz; sem ela, SVG e DXF divergiriam para o mesmo desenho, que é justamente o
 * que a IR existe para impedir.
 */
function normalizar(part: Part): { paths: CadPath[]; w: number; h: number } {
	const bb = bboxOf(part.paths);
	const paths =
		Math.abs(bb.minX) < EPS && Math.abs(bb.minY) < EPS
			? part.paths
			: part.paths.map((p) => translatePath(p, -bb.minX, -bb.minY));
	return { paths, w: bb.w, h: bb.h };
}

/**
 * Fallback sem nesting: todas as instâncias enfileiradas no eixo X com `gap`
 * entre elas. Serve para conferir o desenho, não para produzir — a chapa real
 * sai do nesting.
 */
function arranjarLadoALado(sketch: Sketch2D, gap: number): CadPath[] {
	const out: CadPath[] = [];
	let cursor = 0;
	for (const part of sketch.parts) {
		const qty = qtyDe(part);
		if (qty === 0) continue;
		const base = normalizar(part);
		for (let i = 0; i < qty; i++) {
			out.push(...mover(base.paths, cursor, 0));
			cursor += base.w + gap;
		}
	}
	return out;
}

/** Aplica cada `Placement` do nesting: rotação 0/90 e depois translação. */
function arranjarComNest(
	sketch: Sketch2D,
	nest: NestResult,
	incluirChapa: boolean,
): CadPath[] {
	// Normaliza cada peça DISTINTA uma vez só: um job com centenas de instâncias
	// refaria a mesma bbox centenas de vezes.
	const porId = new Map(
		sketch.parts.map((p) => [p.id, normalizar(p)] as const),
	);
	const out: CadPath[] = [];
	let offset = 0;
	for (const sheet of nest.sheets) {
		if (incluirChapa) {
			out.push(
				translatePath(rect(0, 0, sheet.w, sheet.h, 'REFERENCIA'), offset, 0),
			);
		}
		for (const pl of sheet.placements) {
			const base = porId.get(pl.partId);
			if (!base) {
				throw new ToolEngineError(
					400,
					`O nesting posiciona a peça "${pl.partId}", que não existe no desenho.`,
				);
			}
			// Rotaciona primeiro (a rotação leva a peça de volta ao primeiro
			// quadrante) e só então translada para o ponto da chapa.
			const girado =
				pl.rot === 90
					? base.paths.map((p) => rotatePath90(p, base.w, base.h))
					: base.paths;
			out.push(...mover(girado, offset + pl.x, pl.y));
		}
		offset += sheet.w + GAP_CHAPAS;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Emissão de entidades
// ---------------------------------------------------------------------------

function emitir(w: DxfWriter, path: CadPath): void {
	const layerName = path.layer;
	const s = path.seg;
	switch (s.k) {
		case 'line':
			w.addLine(point3d(n(s.a.x), n(s.a.y)), point3d(n(s.b.x), n(s.b.y)), {
				layerName,
			});
			return;
		case 'arc': {
			// ARMADILHA: o ARC do DXF é SEMPRE percorrido em sentido anti-horário do
			// ângulo 50 para o 51 — não existe arco horário no formato. Um arco
			// horário da IR é o MESMO desenho com as pontas trocadas; sem essa troca
			// sai o arco complementar (o "resto" da circunferência).
			const [ini, fim] = s.ccw ? [s.a0, s.a1] : [s.a1, s.a0];
			w.addArc(point3d(n(s.c.x), n(s.c.y)), n(s.r), grau(ini), grau(fim), {
				layerName,
			});
			return;
		}
		case 'circle':
			w.addCircle(point3d(n(s.c.x), n(s.c.y)), n(s.r), { layerName });
			return;
		case 'poly': {
			// bulges[i] descreve o trecho que SAI do vértice i — exatamente a
			// semântica do grupo 42 do LWPOLYLINE, então é cópia direta.
			const vertices = s.pts.map((p, i) => {
				const b = s.bulges?.[i] ?? 0;
				return {
					point: point2d(n(p.x), n(p.y)),
					...(Math.abs(b) > EPS ? { bulge: n(b, 9) } : {}),
				};
			});
			w.addLWPolyline(vertices, {
				layerName,
				flags: s.closed ? LWPolylineFlags.Closed : LWPolylineFlags.None,
			});
			return;
		}
		case 'text': {
			const at = point3d(n(s.at.x), n(s.at.y));
			const alinhado = s.anchor === 'c' || s.anchor === 'r';
			w.addText(at, n(s.h), s.text, {
				layerName,
				...(s.rot ? { rotation: n(s.rot) } : {}),
				// Alinhamento diferente de esquerda só vale no DXF com o SEGUNDO ponto
				// (grupo 11) preenchido; sem ele o leitor joga o texto para a origem.
				...(alinhado
					? {
							horizontalAlignment:
								s.anchor === 'c'
									? TextHorizontalAlignment.Center
									: TextHorizontalAlignment.Right,
							secondAlignmentPoint: at,
						}
					: {}),
			});
			return;
		}
	}
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Gera o DXF do desenho. Com `nest`, cada peça sai na posição/rotação que o
 * nesting definiu; sem ele, as instâncias saem enfileiradas com um gap.
 */
export function sketchToDxf(
	sketch: Sketch2D,
	nest?: NestResult,
	opts?: DxfOptions,
): string {
	const paths = nest
		? arranjarComNest(sketch, nest, opts?.incluirChapa === true)
		: arranjarLadoALado(sketch, opts?.gap ?? GAP_PADRAO);

	if (paths.length === 0) {
		throw new ToolEngineError(
			400,
			'Não há geometria para exportar: o desenho não produziu nenhuma peça.',
		);
	}

	const w = new DxfWriter();
	w.setUnits(Units.Millimeters);

	// Só as layers realmente usadas, na ordem canônica da IR — layer vazia vira
	// linha morta na lista de operações do software da máquina.
	const usadas = new Set(paths.map((p) => p.layer));
	for (const layer of LAYER_IDS) {
		if (usadas.has(layer)) {
			w.addLayer(layer, LAYER_COLOR_ACI[layer], 'Continuous');
		}
	}

	// Extensões do conteúdo REAL: é o que faz o software abrir já enquadrado no
	// desenho em vez de num vazio a 10 m da peça.
	const bb = bboxOf(paths);
	w.setVariable('$EXTMIN', { 10: n(bb.minX), 20: n(bb.minY), 30: 0 });
	w.setVariable('$EXTMAX', { 10: n(bb.maxX), 20: n(bb.maxY), 30: 0 });

	// Agrupa por layer (ordem canônica) preservando a ordem interna: arquivo
	// legível e operações contíguas na importação.
	for (const layer of LAYER_IDS) {
		for (const path of paths) {
			if (path.layer === layer) emitir(w, path);
		}
	}

	return w.stringify();
}
