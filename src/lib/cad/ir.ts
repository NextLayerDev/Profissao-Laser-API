/**
 * IR (representação intermediária) do motor CAD: fonte ÚNICA de SVG, DXF, 3D e
 * métricas. Todo gerador de peça produz um `Sketch2D`; nenhum exportador
 * inventa geometria.
 *
 * Módulo PURO de propósito: só Node built-ins. Não importe daqui nada que leia
 * env no topo (`lib/supabase.ts`, `lib/tool-definitions.ts`) — isso derruba a
 * suíte inteira de testes.
 *
 * Convenções fixas do sistema de coordenadas:
 * - unidade sempre mm; Y aponta PARA CIMA (igual DXF/SVG-invertido, não SVG cru);
 * - ângulos de arco em RADIANOS; rotação de texto em GRAUS (é o que o DXF pede).
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type LayerId =
	| 'CORTE'
	| 'GRAVACAO'
	| 'MARCACAO'
	| 'DOBRA'
	| 'REFERENCIA';

/** Ordem canônica das layers (usada por exportadores para emitir na mesma sequência). */
export const LAYER_IDS: readonly LayerId[] = [
	'CORTE',
	'GRAVACAO',
	'MARCACAO',
	'DOBRA',
	'REFERENCIA',
];

export interface Pt {
	x: number;
	y: number;
}

export type Seg =
	| { k: 'line'; a: Pt; b: Pt }
	| { k: 'arc'; c: Pt; r: number; a0: number; a1: number; ccw: boolean }
	| { k: 'circle'; c: Pt; r: number }
	| { k: 'poly'; pts: Pt[]; closed: boolean; bulges?: number[] }
	| {
			k: 'text';
			at: Pt;
			text: string;
			h: number;
			rot?: number;
			anchor?: 'l' | 'c' | 'r';
	  };

export interface CadPath {
	layer: LayerId;
	seg: Seg;
	id?: string;
}

export interface Pose {
	pos: [number, number, number];
	rot: [number, number, number];
}

export interface Part {
	id: string;
	label: string;
	thickness: number;
	material: string;
	paths: CadPath[];
	bbox: { w: number; h: number };
	qty: number;
	/** Pose da 1ª instância na montagem 3D. */
	pose?: Pose;
	/**
	 * Poses de TODAS as instâncias, quando `qty > 1` e elas ocupam lugares
	 * diferentes na montagem (os dois pés de uma churrasqueira). Quando presente,
	 * manda em `pose` — que continua sendo a da primeira, para quem só lê uma.
	 *
	 * Sem isto, `qty` é só quantidade a CORTAR: o nesting e as estatísticas
	 * multiplicam por ele, mas a montagem 3D desenharia um pé só e ninguém veria
	 * que faltava o outro.
	 */
	poses?: Pose[];
}

export interface Sketch2D {
	units: 'mm';
	schema: 1;
	parts: Part[];
	meta: {
		generator: string;
		params: Record<string, unknown>;
		kerf: number;
		clearance: number;
		warnings: string[];
		stats: {
			partCount: number;
			cutLengthMm: number;
			engraveLengthMm: number;
			pierces: number;
			areaMm2: number;
		};
	};
}

export interface Placement {
	partId: string;
	instance: number;
	x: number;
	y: number;
	rot: 0 | 90;
}

export interface Sheet {
	w: number;
	h: number;
	placements: Placement[];
}

export interface NestResult {
	sheets: Sheet[];
	utilization: number[];
	unplaced: string[];
	gap: number;
	margin: number;
}

export interface BBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	w: number;
	h: number;
}

// ---------------------------------------------------------------------------
// Constantes e utilitários numéricos
// ---------------------------------------------------------------------------

export const TAU = Math.PI * 2;

/** Tolerância geométrica: 1 nm em mm. Abaixo disso é ruído de ponto flutuante. */
export const EPS = 1e-9;

/** Normaliza um ângulo para [0, 2π). */
function norm(a: number): number {
	return ((a % TAU) + TAU) % TAU;
}

// ---------------------------------------------------------------------------
// Bulge — a ponte entre DXF e SVG
// ---------------------------------------------------------------------------

/**
 * O `bulge` é o parâmetro de arco do LWPOLYLINE do DXF: `bulge = tan(Δθ/4)`,
 * onde Δθ é o ângulo varrido pelo arco entre dois vértices consecutivos
 * (positivo = anti-horário). Existe aqui porque:
 * - o DXF o consome nativamente (nada a converter na exportação);
 * - o SVG converte para o comando `A` de forma trivial (raio + flags saem
 *   direto de Δθ).
 * Sem ele, todo canto arredondado viraria polilinha de 16 pontos: arquivo
 * gordo, contorno facetado e a máquina desacelerando em cada vértice.
 *
 * Valores de referência: 90° → tan(22,5°) ≈ 0,4142 · 180° → tan(45°) = 1.
 */
export function bulgeFromSweep(sweep: number): number {
	return Math.tan(sweep / 4);
}

/** Inverso de `bulgeFromSweep`: Δθ = 4·atan(bulge). Sinal preservado. */
export function sweepFromBulge(bulge: number): number {
	return 4 * Math.atan(bulge);
}

/** Bulge de um canto de 90° anti-horário (o dos cantos arredondados). */
export const BULGE_90 = bulgeFromSweep(Math.PI / 2);

/** Bulge de um semicírculo anti-horário (as pontas de um rasgo). */
export const BULGE_180 = 1;

/**
 * Converte o par (vértices, bulge) na forma canônica de arco.
 * Derivação: com Δθ = 4·atan(b) e corda `d`, o raio com sinal é
 * `r = (d/2) / sin(Δθ/2)` e o centro fica sobre a normal ESQUERDA da corda a
 * uma distância `r·cos(Δθ/2)` — o que dá o clássico `(1/b − b)/2 · (d/2)`.
 */
export function arcFromBulge(
	p1: Pt,
	p2: Pt,
	bulge: number,
): { c: Pt; r: number; a0: number; a1: number; ccw: boolean } | null {
	if (Math.abs(bulge) < EPS) return null; // bulge 0 = reta
	const dx = p2.x - p1.x;
	const dy = p2.y - p1.y;
	const d = Math.hypot(dx, dy);
	if (d < EPS) return null; // vértices coincidentes: arco degenerado
	const sweep = sweepFromBulge(bulge);
	const rSigned = d / 2 / Math.sin(sweep / 2);
	// Normal esquerda da corda (rotação de +90° do vetor unitário p1→p2).
	const nx = -dy / d;
	const ny = dx / d;
	const off = rSigned * Math.cos(sweep / 2);
	const c: Pt = {
		x: (p1.x + p2.x) / 2 + off * nx,
		y: (p1.y + p2.y) / 2 + off * ny,
	};
	return {
		c,
		r: Math.abs(rSigned),
		a0: Math.atan2(p1.y - c.y, p1.x - c.x),
		a1: Math.atan2(p2.y - c.y, p2.x - c.x),
		ccw: bulge > 0,
	};
}

/**
 * Ângulo varrido (sempre >= 0) de um arco definido por (a0, a1, ccw).
 * ATENÇÃO: a0 === a1 devolve 0, não uma volta completa — círculo inteiro é
 * `{ k: 'circle' }`, nunca um arco de 360°.
 */
export function arcSweep(a0: number, a1: number, ccw: boolean): number {
	return norm(ccw ? a1 - a0 : a0 - a1);
}

// ---------------------------------------------------------------------------
// Construtores de geometria
// ---------------------------------------------------------------------------

/** Retângulo com canto inferior-esquerdo em (x, y), como polilinha fechada anti-horária. */
export function rect(
	x: number,
	y: number,
	w: number,
	h: number,
	layer: LayerId,
): CadPath {
	return {
		layer,
		seg: {
			k: 'poly',
			closed: true,
			pts: [
				{ x, y },
				{ x: x + w, y },
				{ x: x + w, y: y + h },
				{ x, y: y + h },
			],
		},
	};
}

/**
 * Retângulo de cantos arredondados. Os 4 cantos são arcos de 90° via bulge —
 * não facetados. `r` é limitado a metade do menor lado (acima disso o canto
 * comeria o lado adjacente); r <= 0 devolve o retângulo reto.
 */
export function roundRect(
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
	layer: LayerId,
): CadPath {
	const rr = Math.min(r, Math.min(w, h) / 2);
	if (rr <= EPS) return rect(x, y, w, h, layer);
	return {
		layer,
		seg: {
			k: 'poly',
			closed: true,
			pts: [
				{ x: x + rr, y },
				{ x: x + w - rr, y },
				{ x: x + w, y: y + rr },
				{ x: x + w, y: y + h - rr },
				{ x: x + w - rr, y: y + h },
				{ x: x + rr, y: y + h },
				{ x, y: y + h - rr },
				{ x, y: y + rr },
			],
			// bulges[i] vale para o trecho que SAI do vértice i (convenção do DXF).
			bulges: [0, BULGE_90, 0, BULGE_90, 0, BULGE_90, 0, BULGE_90],
		},
	};
}

export function circle(c: Pt, r: number, layer: LayerId): CadPath {
	return { layer, seg: { k: 'circle', c: { x: c.x, y: c.y }, r } };
}

/**
 * Rasgo (slot) inscrito na caixa (x, y, w, h), com as duas pontas em
 * semicírculo (bulge = 1). As pontas são arredondadas por obrigação, não por
 * estética: canto vivo em rasgo longo concentra tensão (trinca no acrílico) e
 * o laser, ao parar para virar, queima/derrete o canto.
 * Orienta-se sozinho: w >= h vira rasgo horizontal, senão vertical.
 */
export function slot(
	x: number,
	y: number,
	w: number,
	h: number,
	layer: LayerId,
): CadPath {
	if (w >= h) {
		const r = h / 2;
		return {
			layer,
			seg: {
				k: 'poly',
				closed: true,
				pts: [
					{ x: x + r, y },
					{ x: x + w - r, y },
					{ x: x + w - r, y: y + h },
					{ x: x + r, y: y + h },
				],
				bulges: [0, BULGE_180, 0, BULGE_180],
			},
		};
	}
	const r = w / 2;
	return {
		layer,
		seg: {
			k: 'poly',
			closed: true,
			pts: [
				{ x: x + w, y: y + r },
				{ x: x + w, y: y + h - r },
				{ x, y: y + h - r },
				{ x, y: y + r },
			],
			bulges: [0, BULGE_180, 0, BULGE_180],
		},
	};
}

export function polyline(
	pts: Pt[],
	closed: boolean,
	layer: LayerId,
	bulges?: number[],
): CadPath {
	return {
		layer,
		seg: {
			k: 'poly',
			pts: pts.map((p) => ({ x: p.x, y: p.y })),
			closed,
			...(bulges ? { bulges: [...bulges] } : {}),
		},
	};
}

export function text(
	at: Pt,
	str: string,
	h: number,
	layer: LayerId,
	opts?: { rot?: number; anchor?: 'l' | 'c' | 'r' },
): CadPath {
	return {
		layer,
		seg: {
			k: 'text',
			at: { x: at.x, y: at.y },
			text: str,
			h,
			...(opts?.rot !== undefined ? { rot: opts.rot } : {}),
			...(opts?.anchor ? { anchor: opts.anchor } : {}),
		},
	};
}

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

/**
 * Largura aproximada de um caractere como fração da altura. As fontes de traço
 * usadas em CAD (txt.shx e equivalentes) ficam em 0,6–0,7; texto nunca define
 * o contorno de corte, então a aproximação basta para o nesting não cortar a
 * gravura.
 */
export const TEXT_WIDTH_FACTOR = 0.62;

/** Pontos extremos de um arco: extremidades MAIS os cardeais que ele atravessa. */
function arcExtremes(
	c: Pt,
	r: number,
	a0: number,
	a1: number,
	ccw: boolean,
): Pt[] {
	const out: Pt[] = [
		{ x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) },
		{ x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1) },
	];
	const sweep = arcSweep(a0, a1, ccw);
	// Sem isto, a caixa de um arco sai do tamanho da CORDA e não do BOJO: fica
	// menor que a peça e o nesting sobrepõe peças na chapa.
	for (let q = 0; q < 4; q++) {
		const ang = (q * Math.PI) / 2;
		const rel = ccw ? norm(ang - a0) : norm(a0 - ang);
		if (rel <= sweep + EPS) {
			out.push({ x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) });
		}
	}
	return out;
}

/** Pontos extremos de um segmento — o suficiente para a caixa, nada mais. */
function segExtremes(seg: Seg): Pt[] {
	switch (seg.k) {
		case 'line':
			return [seg.a, seg.b];
		case 'circle':
			return [
				{ x: seg.c.x - seg.r, y: seg.c.y - seg.r },
				{ x: seg.c.x + seg.r, y: seg.c.y + seg.r },
			];
		case 'arc':
			return arcExtremes(seg.c, seg.r, seg.a0, seg.a1, seg.ccw);
		case 'poly': {
			const out: Pt[] = [...seg.pts];
			const n = seg.pts.length;
			const last = seg.closed ? n : n - 1;
			for (let i = 0; i < last; i++) {
				const b = seg.bulges?.[i] ?? 0;
				if (Math.abs(b) < EPS) continue;
				const arc = arcFromBulge(seg.pts[i], seg.pts[(i + 1) % n], b);
				if (arc)
					out.push(...arcExtremes(arc.c, arc.r, arc.a0, arc.a1, arc.ccw));
			}
			return out;
		}
		case 'text': {
			const w = seg.text.length * seg.h * TEXT_WIDTH_FACTOR;
			// Baseline em at.y; a caixa sobe uma altura de caixa-alta. Sem folga
			// para descendente — é aproximação declarada, não medida da fonte.
			const dx0 = seg.anchor === 'c' ? -w / 2 : seg.anchor === 'r' ? -w : 0;
			const corners: Pt[] = [
				{ x: dx0, y: 0 },
				{ x: dx0 + w, y: 0 },
				{ x: dx0 + w, y: seg.h },
				{ x: dx0, y: seg.h },
			];
			const rad = ((seg.rot ?? 0) * Math.PI) / 180;
			const cs = Math.cos(rad);
			const sn = Math.sin(rad);
			return corners.map((p) => ({
				x: seg.at.x + p.x * cs - p.y * sn,
				y: seg.at.y + p.x * sn + p.y * cs,
			}));
		}
	}
}

/** Caixa envolvente de um conjunto de caminhos. Lista vazia devolve caixa zerada. */
export function bboxOf(paths: CadPath[]): BBox {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const path of paths) {
		for (const p of segExtremes(path.seg)) {
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.x > maxX) maxX = p.x;
			if (p.y > maxY) maxY = p.y;
		}
	}
	if (!Number.isFinite(minX))
		return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
	return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// ---------------------------------------------------------------------------
// Transformações (usadas pelo nesting)
// ---------------------------------------------------------------------------

export function translatePath(path: CadPath, dx: number, dy: number): CadPath {
	const s = path.seg;
	const mv = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
	let seg: Seg;
	switch (s.k) {
		case 'line':
			seg = { k: 'line', a: mv(s.a), b: mv(s.b) };
			break;
		case 'arc':
			seg = { ...s, c: mv(s.c) };
			break;
		case 'circle':
			seg = { ...s, c: mv(s.c) };
			break;
		case 'poly':
			seg = {
				...s,
				pts: s.pts.map(mv),
				...(s.bulges ? { bulges: [...s.bulges] } : {}),
			};
			break;
		case 'text':
			seg = { ...s, at: mv(s.at) };
			break;
	}
	return { ...path, seg };
}

/**
 * Rotaciona 90° anti-horário e reposiciona no primeiro quadrante: (x, y) →
 * (h − y, x). `w`/`h` são as dimensões da peça; o resultado ocupa h × w.
 * PRESSUPÕE coordenadas locais com origem no canto da bbox (minX = minY = 0) —
 * é como os geradores devem entregar as peças. Fora disso, a peça sai deslocada.
 */
export function rotatePath90(path: CadPath, _w: number, h: number): CadPath {
	const s = path.seg;
	const rt = (p: Pt): Pt => ({ x: h - p.y, y: p.x });
	let seg: Seg;
	switch (s.k) {
		case 'line':
			seg = { k: 'line', a: rt(s.a), b: rt(s.b) };
			break;
		case 'arc':
			// Girar o desenho gira os dois ângulos; o sentido de percurso não muda.
			seg = {
				...s,
				c: rt(s.c),
				a0: s.a0 + Math.PI / 2,
				a1: s.a1 + Math.PI / 2,
			};
			break;
		case 'circle':
			seg = { ...s, c: rt(s.c) };
			break;
		case 'poly':
			// Bulge é invariante sob rotação rígida (depende só do ângulo varrido).
			seg = {
				...s,
				pts: s.pts.map(rt),
				...(s.bulges ? { bulges: [...s.bulges] } : {}),
			};
			break;
		case 'text':
			seg = { ...s, at: rt(s.at), rot: (s.rot ?? 0) + 90 };
			break;
	}
	return { ...path, seg };
}

// ---------------------------------------------------------------------------
// Comprimentos e estatísticas
// ---------------------------------------------------------------------------

/** Comprimento percorrido pelo feixe num segmento, em mm. */
export function segLength(seg: Seg): number {
	switch (seg.k) {
		case 'line':
			return Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
		case 'circle':
			return TAU * seg.r;
		case 'arc':
			return seg.r * arcSweep(seg.a0, seg.a1, seg.ccw);
		case 'poly': {
			const n = seg.pts.length;
			if (n < 2) return 0;
			let total = 0;
			const last = seg.closed ? n : n - 1;
			for (let i = 0; i < last; i++) {
				const p1 = seg.pts[i];
				const p2 = seg.pts[(i + 1) % n];
				const b = seg.bulges?.[i] ?? 0;
				const arc = Math.abs(b) < EPS ? null : arcFromBulge(p1, p2, b);
				total = arc
					? total + arc.r * Math.abs(sweepFromBulge(b))
					: total + Math.hypot(p2.x - p1.x, p2.y - p1.y);
			}
			return total;
		}
		case 'text':
			// Texto vira traço só no RIP da máquina (fonte/hachura do controlador);
			// contabilizar aqui daria número inventado.
			return 0;
	}
}

/**
 * Métricas do job inteiro, já multiplicadas pela quantidade de cada peça.
 * - `partCount`: total de INSTÂNCIAS a cortar (soma dos `qty`), não de peças distintas.
 * - `engraveLengthMm`: GRAVACAO + MARCACAO + DOBRA — as três são passes de baixa
 *   potência na mesma máquina; REFERENCIA nunca vai para a máquina.
 * - `pierces`: uma perfuração por caminho de CORTE. O caso normal é o contorno
 *   fechado (círculo, polilinha fechada), mas trajeto aberto também exige furar
 *   para iniciar — por isso conta igual.
 * - `areaMm2`: área das caixas envolventes, que é o que consome chapa; NÃO é a
 *   área líquida do contorno.
 */
export function computeStats(parts: Part[]): Sketch2D['meta']['stats'] {
	let partCount = 0;
	let cutLengthMm = 0;
	let engraveLengthMm = 0;
	let pierces = 0;
	let areaMm2 = 0;
	for (const part of parts) {
		const qty = Math.max(0, Math.round(part.qty));
		if (qty === 0) continue;
		partCount += qty;
		areaMm2 += part.bbox.w * part.bbox.h * qty;
		let cut = 0;
		let engrave = 0;
		let pierce = 0;
		for (const path of part.paths) {
			if (path.layer === 'REFERENCIA') continue;
			const len = segLength(path.seg);
			if (path.layer === 'CORTE') {
				cut += len;
				if (path.seg.k !== 'text') pierce += 1;
			} else {
				engrave += len;
			}
		}
		cutLengthMm += cut * qty;
		engraveLengthMm += engrave * qty;
		pierces += pierce * qty;
	}
	return { partCount, cutLengthMm, engraveLengthMm, pierces, areaMm2 };
}
