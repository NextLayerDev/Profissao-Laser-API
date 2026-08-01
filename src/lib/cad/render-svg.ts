/**
 * Exportador SVG do motor CAD: `Sketch2D` (+ `NestResult` opcional) → string SVG.
 *
 * O SVG aqui é PREVIEW e documento de medida ao mesmo tempo — por isso sai em
 * milímetros de verdade (abrir no Inkscape/Illustrator e medir dá a medida da
 * peça). Nada de geometria é inventado: tudo vem da IR, igualzinho ao que o DXF
 * vai receber.
 *
 * Módulo PURO: só `./ir.js` e Node built-ins (Buffer). Nada que leia env no topo.
 */

import { ToolEngineError } from '../tool-errors.js';
import {
	arcFromBulge,
	arcSweep,
	bboxOf,
	type CadPath,
	EPS,
	LAYER_IDS,
	type LayerId,
	type NestResult,
	type Part,
	type Pt,
	rotatePath90,
	type Seg,
	type Sketch2D,
	sweepFromBulge,
	translatePath,
} from './ir.js';

// ---------------------------------------------------------------------------
// Estilo por camada
// ---------------------------------------------------------------------------

interface LayerStyle {
	cor: string;
	/** Padrão de tracejado, em mm, quando a camada não é um traço cheio. */
	dash?: string;
}

const LAYER_STYLE: Record<LayerId, LayerStyle> = {
	CORTE: { cor: '#e11d48' },
	GRAVACAO: { cor: '#2563eb' },
	// Dobra é vinco, não corte: tracejado para o aluno não confundir com contorno.
	DOBRA: { cor: '#a855f7', dash: '2 1.5' },
	MARCACAO: { cor: '#16a34a' },
	REFERENCIA: { cor: '#94a3b8', dash: '1 1' },
};

export interface SvgOptions {
	/** Folga em mm ao redor do conteúdo (default 4). */
	margin?: number;
	/** Espessura do traço (default 0,2 mm). */
	strokeWidth?: number;
	/** Cor de fundo; sem isso o SVG sai transparente. */
	background?: string;
	/** Qual chapa do nesting desenhar (default 0). Ignorado sem `nest`. */
	sheet?: number;
	/** Espaço entre peças no layout SEM nesting (default 6 mm). */
	gap?: number;
	/** Largura máxima antes de quebrar linha no layout SEM nesting (default 900 mm). */
	maxWidth?: number;
}

const DEFAULTS = {
	margin: 4,
	strokeWidth: 0.2,
	sheet: 0,
	gap: 6,
	maxWidth: 900,
} as const;

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

/** 4 casas bastam para 0,1 µm; e mata o `-0` que o flip de sinal produz. */
function n(v: number): string {
	const r = Math.round(v * 1e4) / 1e4;
	return Object.is(r, -0) ? '0' : String(r);
}

function xmlEscape(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Segmento → elemento SVG
// ---------------------------------------------------------------------------

function polarPt(c: Pt, r: number, a: number): Pt {
	return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
}

/**
 * Comando `A` do SVG a partir de um arco já resolvido.
 *
 * `large-arc-flag` = varredura > 180°. `sweep-flag` = 1 significa "sentido de
 * ângulo CRESCENTE no sistema de coordenadas local" — e o sistema local aqui é
 * o do CAD (Y para cima, imposto pelo `<g>` de flip), então ângulo crescente é
 * exatamente o anti-horário da IR. Por isso `ccw → 1` sem inversão: quem inverte
 * é o flip do grupo pai, não a flag.
 */
function arcTo(end: Pt, r: number, sweep: number, ccw: boolean): string {
	const large = sweep > Math.PI ? 1 : 0;
	return `A ${n(r)} ${n(r)} 0 ${large} ${ccw ? 1 : 0} ${n(end.x)} ${n(end.y)}`;
}

function polyD(pts: Pt[], closed: boolean, bulges?: number[]): string {
	if (pts.length === 0) return '';
	const cmds = [`M ${n(pts[0].x)} ${n(pts[0].y)}`];
	const total = pts.length;
	const last = closed ? total : total - 1;
	for (let i = 0; i < last; i++) {
		const p1 = pts[i];
		const p2 = pts[(i + 1) % total];
		const b = bulges?.[i] ?? 0;
		const arc = Math.abs(b) < EPS ? null : arcFromBulge(p1, p2, b);
		cmds.push(
			arc
				? arcTo(p2, arc.r, Math.abs(sweepFromBulge(b)), b > 0)
				: `L ${n(p2.x)} ${n(p2.y)}`,
		);
	}
	// O `Z` depois de um arco de fechamento é reta de comprimento zero: inofensivo,
	// e garante que o preenchimento/junção de traço trate o contorno como fechado.
	if (closed) cmds.push('Z');
	return cmds.join(' ');
}

/** Atributos comuns a todo elemento desenhável. */
const HAIRLINE = 'vector-effect="non-scaling-stroke"';

function segToSvg(seg: Seg): string {
	switch (seg.k) {
		case 'line':
			return `<path ${HAIRLINE} d="M ${n(seg.a.x)} ${n(seg.a.y)} L ${n(seg.b.x)} ${n(seg.b.y)}"/>`;
		case 'circle':
			return `<circle ${HAIRLINE} cx="${n(seg.c.x)}" cy="${n(seg.c.y)}" r="${n(seg.r)}"/>`;
		case 'arc': {
			const sweep = arcSweep(seg.a0, seg.a1, seg.ccw);
			// arcSweep(a0, a0) devolve 0 (círculo inteiro é `k: 'circle'`, nunca arco
			// de 360°) — desenhar isso viraria um `A` degenerado que alguns viewers
			// interpretam como reta. Melhor não emitir nada.
			if (sweep < EPS) return '';
			const p0 = polarPt(seg.c, seg.r, seg.a0);
			const p1 = polarPt(seg.c, seg.r, seg.a1);
			return `<path ${HAIRLINE} d="M ${n(p0.x)} ${n(p0.y)} ${arcTo(p1, seg.r, sweep, seg.ccw)}"/>`;
		}
		case 'poly': {
			const d = polyD(seg.pts, seg.closed, seg.bulges);
			return d ? `<path ${HAIRLINE} d="${d}"/>` : '';
		}
		case 'text': {
			const anchor =
				seg.anchor === 'c' ? 'middle' : seg.anchor === 'r' ? 'end' : 'start';
			// ARMADILHA CLÁSSICA: o grupo pai está espelhado em Y para converter o
			// CAD (Y para cima) no SVG (Y para baixo). Glifo herda esse espelho e sai
			// de cabeça para baixo. O `scale(1,-1)` local desfaz o espelho SÓ para o
			// texto. E como o frame interno volta a ter Y para baixo, a rotação do CAD
			// (graus anti-horário) tem que entrar com o sinal trocado.
			const rot = seg.rot ?? 0;
			const rotAttr = rot === 0 ? '' : ` rotate(${n(-rot)})`;
			return (
				`<text transform="translate(${n(seg.at.x)} ${n(seg.at.y)}) scale(1 -1)${rotAttr}"` +
				` font-size="${n(seg.h)}" font-family="monospace" text-anchor="${anchor}"` +
				` fill="currentColor" stroke="none">${xmlEscape(seg.text)}</text>`
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Montagem dos grupos
// ---------------------------------------------------------------------------

/** Uma instância de peça já POSICIONADA no plano final. */
interface Instancia {
	partId: string;
	instance: number;
	paths: CadPath[];
}

/**
 * Emite uma instância como um `<g>` POR CAMADA. O front liga/desliga camadas
 * lendo `data-layer` — por isso a camada é atributo de grupo e não de elemento.
 */
function instanciaToSvg(inst: Instancia): string {
	const out: string[] = [];
	for (const layer of LAYER_IDS) {
		const doLayer = inst.paths.filter((p) => p.layer === layer);
		if (doLayer.length === 0) continue;
		const style = LAYER_STYLE[layer];
		const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : '';
		// `color` (e não só `stroke`) porque o texto usa `fill="currentColor"`.
		out.push(
			`<g data-layer="${layer}" data-part="${xmlEscape(inst.partId)}"` +
				` data-instance="${inst.instance}" stroke="${style.cor}" color="${style.cor}"${dash}>`,
		);
		for (const path of doLayer) {
			const el = segToSvg(path.seg);
			if (el) out.push(`\t${el}`);
		}
		out.push('</g>');
	}
	return out.join('\n');
}

/**
 * Traz a peça para a origem local (minX = minY = 0). É pré-condição do
 * `rotatePath90` da IR e é o que faz `Placement.x/y` significar "canto
 * inferior-esquerdo da peça na chapa".
 */
function normalizar(part: Part): { paths: CadPath[]; w: number; h: number } {
	const bb = bboxOf(part.paths);
	const paths =
		Math.abs(bb.minX) < EPS && Math.abs(bb.minY) < EPS
			? part.paths
			: part.paths.map((p) => translatePath(p, -bb.minX, -bb.minY));
	return { paths, w: bb.w, h: bb.h };
}

/** Instâncias posicionadas a partir de uma chapa do nesting. */
function instanciasDoNest(
	sketch: Sketch2D,
	nest: NestResult,
	sheetIdx: number,
	margin: number,
): {
	instancias: Instancia[];
	w: number;
	h: number;
	sheetW: number;
	sheetH: number;
} {
	const sheet = nest.sheets[sheetIdx];
	// Normaliza cada peça DISTINTA uma vez só: uma chapa cheia repetiria a mesma
	// bbox a cada instância.
	const porId = new Map(
		sketch.parts.map((p) => [p.id, normalizar(p)] as const),
	);
	const instancias: Instancia[] = [];
	for (const pl of sheet.placements) {
		const base = porId.get(pl.partId);
		if (!base) continue; // placement órfão: o nesting é quem valida, aqui só ignora
		const girado =
			pl.rot === 90
				? base.paths.map((p) => rotatePath90(p, base.w, base.h))
				: base.paths;
		instancias.push({
			partId: pl.partId,
			instance: pl.instance,
			paths: girado.map((p) => translatePath(p, pl.x + margin, pl.y + margin)),
		});
	}
	return {
		instancias,
		w: sheet.w + margin * 2,
		h: sheet.h + margin * 2,
		sheetW: sheet.w,
		sheetH: sheet.h,
	};
}

/**
 * Layout de prateleira para quando NÃO há nesting: uma cópia de cada peça
 * distinta, da esquerda para a direita, quebrando linha em `maxWidth`.
 * `qty` é ignorado de propósito — isto é conferência de desenho, não simulação
 * de chapa (quem simula chapa é o nesting).
 */
function instanciasEmGrade(
	sketch: Sketch2D,
	margin: number,
	gap: number,
	maxWidth: number,
): { instancias: Instancia[]; w: number; h: number } {
	interface Item {
		partId: string;
		paths: CadPath[];
		w: number;
		h: number;
		x: number;
	}
	const linhas: { itens: Item[]; h: number }[] = [];
	let atual: { itens: Item[]; h: number } = { itens: [], h: 0 };
	let cursor = 0;
	let larguraMax = 0;
	for (const part of sketch.parts) {
		const base = normalizar(part);
		if (atual.itens.length > 0 && cursor + base.w > maxWidth) {
			linhas.push(atual);
			atual = { itens: [], h: 0 };
			cursor = 0;
		}
		atual.itens.push({
			partId: part.id,
			paths: base.paths,
			w: base.w,
			h: base.h,
			x: cursor,
		});
		cursor += base.w + gap;
		atual.h = Math.max(atual.h, base.h);
		larguraMax = Math.max(larguraMax, cursor - gap);
	}
	if (atual.itens.length > 0) linhas.push(atual);

	const alturaConteudo = linhas.reduce(
		(acc, l, i) => acc + l.h + (i > 0 ? gap : 0),
		0,
	);
	const w = larguraMax + margin * 2;
	const h = alturaConteudo + margin * 2;

	// Y do CAD cresce para cima: para a PRIMEIRA linha aparecer no TOPO do preview
	// (ordem de leitura), ela precisa do maior Y — daí empilhar de cima para baixo.
	const instancias: Instancia[] = [];
	let topo = h - margin;
	for (const linha of linhas) {
		const base = topo - linha.h;
		for (const item of linha.itens) {
			instancias.push({
				partId: item.partId,
				instance: 0,
				paths: item.paths.map((p) => translatePath(p, item.x + margin, base)),
			});
		}
		topo = base - gap;
	}
	return { instancias, w, h };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Renderiza o sketch como SVG. Com `nest`, desenha a chapa `opts.sheet`
 * (default 0) com as peças nas posições do nesting; sem `nest`, uma cópia de
 * cada peça em grade.
 */
export function sketchToSvg(
	sketch: Sketch2D,
	nest?: NestResult,
	opts?: SvgOptions,
): string {
	const margin = opts?.margin ?? DEFAULTS.margin;
	const strokeWidth = opts?.strokeWidth ?? DEFAULTS.strokeWidth;
	const gap = opts?.gap ?? DEFAULTS.gap;
	const maxWidth = opts?.maxWidth ?? DEFAULTS.maxWidth;
	const sheetIdx = opts?.sheet ?? DEFAULTS.sheet;

	// Pedir a folha 8 de um job de 7 chapas caía no layout de conferência sem
	// avisar: o arquivo saía plausível e completamente diferente do pedido. Se o
	// chamador passou `nest`, ele quer UMA chapa específica — índice fora da
	// faixa é erro, não fallback.
	if (nest && sheetIdx >= nest.sheets.length) {
		throw new ToolEngineError(
			400,
			`Chapa ${sheetIdx + 1} não existe: este job usa ${nest.sheets.length} chapa(s).`,
		);
	}
	const chapa =
		nest?.sheets[sheetIdx] !== undefined
			? instanciasDoNest(sketch, nest, sheetIdx, margin)
			: null;
	const layout = chapa ?? instanciasEmGrade(sketch, margin, gap, maxWidth);

	// Sketch vazio ainda tem que produzir SVG válido: dimensão 0 é rejeitada por
	// parte dos renderizadores.
	const W = Math.max(layout.w, 1);
	const H = Math.max(layout.h, 1);

	const corpo: string[] = [];

	if (chapa) {
		const st = LAYER_STYLE.REFERENCIA;
		corpo.push(
			`<g data-layer="REFERENCIA" data-part="__chapa" stroke="${st.cor}" color="${st.cor}">`,
			`\t<rect ${HAIRLINE} x="${n(margin)}" y="${n(margin)}" width="${n(chapa.sheetW)}" height="${n(chapa.sheetH)}"/>`,
			'</g>',
		);
	}
	for (const inst of layout.instancias) corpo.push(instanciaToSvg(inst));

	const fundo = opts?.background
		? `\n\t<rect x="0" y="0" width="${n(W)}" height="${n(H)}" fill="${xmlEscape(opts.background)}" stroke="none"/>`
		: '';

	// `width/height` em mm + `viewBox` em unidades iguais aos mm da IR: é isso que
	// faz o arquivo abrir no tamanho REAL da peça em qualquer editor vetorial.
	// O `<g>` de flip converte o Y do CAD (para cima) no Y do SVG (para baixo) —
	// sem ele a peça sai espelhada verticalmente.
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${n(W)}mm" height="${n(H)}mm"` +
			` viewBox="0 0 ${n(W)} ${n(H)}" data-units="mm">${fundo}`,
		`<g transform="translate(0 ${n(H)}) scale(1 -1)" fill="none" stroke-width="${n(strokeWidth)}" stroke-linejoin="round" stroke-linecap="round">`,
		...corpo,
		'</g>',
		'</svg>',
	].join('\n');
}

/**
 * Mesmo SVG, como data URL pronta para `<img src>`.
 * BASE64 obrigatoriamente: em data URL utf8 crua o `#` das cores é lido como
 * início de fragmento e o documento é truncado no primeiro `stroke="#e11d48"`.
 */
export function sketchToDataUrl(
	sketch: Sketch2D,
	nest?: NestResult,
	opts?: SvgOptions,
): string {
	const svg = sketchToSvg(sketch, nest, opts);
	return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
