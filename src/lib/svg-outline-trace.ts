import * as Potrace from 'potrace';
import { encodeMaskToPng } from './svg-negative.js';

// ─────────────────────────────────────────────────────────────────────
// Traçado de CONTORNO de máscara binária — os dois modos do Inverter
// (geométrico delimitado e silhueta de foto) precisam da mesma dupla:
// traçar uma máscara com o Potrace e trazer o `d` de volta pro sistema de
// coordenadas do SVG original SEM `transform=` (svgToDxf e readSvgGeometry
// não suportam transform — um path transformado sairia deslocado no DXF).
// ─────────────────────────────────────────────────────────────────────

/**
 * Espessura do contorno fino da silhueta, como fração da MENOR dimensão do
 * raster de trabalho. Requisito do produto: "bem fino" — na prática ~0,4mm
 * numa peça de 100mm. É o único knob a mexer se o anel sair grosso/fino
 * demais no material real.
 */
export const OUTLINE_MARGIN_FRACTION = 0.004;
export const OUTLINE_MARGIN_MIN_PX = 2;
export const OUTLINE_MARGIN_MAX_PX = 10;

/** Margem (px do raster de trabalho) entre a arte e o limite do invertido. */
export function outlineMarginPx(minDim: number): number {
	return Math.min(
		OUTLINE_MARGIN_MAX_PX,
		Math.max(
			OUTLINE_MARGIN_MIN_PX,
			Math.round(minDim * OUTLINE_MARGIN_FRACTION),
		),
	);
}

/**
 * Lado do maior speck descartável, como fração de minDim. 0,0035 ⇒ ~7px a
 * 2000 (área ≤49px², ~0,35mm numa peça de 100mm) — poeira do JPEG, invisível
 * no normal mas conspícua no invertido (vira fleck branco no campo preto) e
 * responsável por serrilhar a borda da silhueta. Bem abaixo do menor
 * detalhe legítimo (contraforma de letra pequena ≈ centenas de px²).
 */
export const SPECK_SIDE_FRACTION = 0.0035;

/** Área máxima (px²) de um componente de tinta descartável como poeira. */
export function speckMaxAreaPx(minDim: number): number {
	const side = Math.max(4, Math.round(minDim * SPECK_SIDE_FRACTION));
	return side * side;
}

/**
 * Remove da máscara os componentes 4-conectados com área ≤ `maxArea`.
 * Devolve uma cópia — a máscara original não é mutada.
 */
export function removeSmallInkComponents(
	mask: Uint8Array,
	W: number,
	H: number,
	maxArea: number,
): Uint8Array {
	const N = W * H;
	const out = Uint8Array.from(mask);
	const label = new Int32Array(N).fill(-1);
	const stack = new Int32Array(N);
	const comp: number[] = [];
	for (let seed = 0; seed < N; seed++) {
		if (mask[seed] !== 1 || label[seed] >= 0) continue;
		let sp = 0;
		let count = 0;
		stack[sp++] = seed;
		label[seed] = seed;
		comp.length = 0;
		while (sp > 0) {
			const i = stack[--sp];
			count++;
			if (count <= maxArea) comp.push(i);
			const x = i % W;
			const y = (i / W) | 0;
			const nb = [
				x > 0 ? i - 1 : -1,
				x < W - 1 ? i + 1 : -1,
				y > 0 ? i - W : -1,
				y < H - 1 ? i + W : -1,
			];
			for (const j of nb) {
				if (j >= 0 && mask[j] === 1 && label[j] < 0) {
					label[j] = seed;
					stack[sp++] = j;
				}
			}
		}
		if (count <= maxArea) for (const i of comp) out[i] = 0;
	}
	return out;
}

/**
 * Filtra de uma lista de `d` (comandos ABSOLUTOS) os SUBPATHS com área menor
 * que `minArea` (unidades² do próprio `d`). É o par vetorial do despeckle
 * raster: sem ele, o speck descartado da máscara continuaria sendo desenhado
 * como furo branco minúsculo no campo invertido.
 *
 * Área por shoelace sobre o polígono amostrado (cúbicas viram 8 segmentos —
 * aproximação de sobra pra decidir "é poeira?"). Qualquer coisa não
 * parseável mantém o subpath (na dúvida, não descarta arte).
 */
export function dropTinySubpaths(ds: string[], minArea: number): string[] {
	const out: string[] = [];
	for (const d of ds) {
		const kept = filterOneD(d, minArea);
		if (kept) out.push(kept);
	}
	return out;
}

function filterOneD(d: string, minArea: number): string {
	const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
	let i = 0;
	let cmd = '';
	let cx = 0;
	let cy = 0;
	const subs: { text: string; area: number }[] = [];
	let cur: { start: number; pts: number[] } | null = null;

	const num = () => Number.parseFloat(tokens[i++]);
	const flush = (endIdx: number) => {
		if (!cur) return;
		const pts = cur.pts;
		let area = 0;
		for (let k = 0; k + 3 < pts.length; k += 2) {
			area += pts[k] * pts[k + 3] - pts[k + 2] * pts[k + 1];
		}
		// fecha o polígono
		if (pts.length >= 4) {
			const n = pts.length;
			area += pts[n - 2] * pts[1] - pts[0] * pts[n - 1];
		}
		subs.push({
			text: rebuild(cur.start, endIdx),
			area: Math.abs(area / 2),
		});
		cur = null;
	};
	const rebuild = (from: number, to: number) =>
		tokens.slice(from, to).join(' ');

	try {
		while (i < tokens.length) {
			const t = tokens[i];
			if (/^[a-zA-Z]$/.test(t)) {
				if (t === 'Z' || t === 'z') {
					i++;
					flush(i);
					continue;
				}
				if (!['M', 'L', 'C', 'H', 'V'].includes(t)) return d; // não mexe
				if (t === 'M') {
					flush(i);
					cur = { start: i, pts: [] };
				}
				cmd = t;
				i++;
				continue;
			}
			switch (cmd) {
				case 'M':
					cx = num();
					cy = num();
					cur?.pts.push(cx, cy);
					cmd = 'L';
					break;
				case 'L':
					cx = num();
					cy = num();
					cur?.pts.push(cx, cy);
					break;
				case 'C': {
					const x1 = num();
					const y1 = num();
					const x2 = num();
					const y2 = num();
					const x = num();
					const y = num();
					for (let s = 1; s <= 8; s++) {
						const u = s / 8;
						const m = 1 - u;
						cur?.pts.push(
							m * m * m * cx +
								3 * m * m * u * x1 +
								3 * m * u * u * x2 +
								u * u * u * x,
							m * m * m * cy +
								3 * m * m * u * y1 +
								3 * m * u * u * y2 +
								u * u * u * y,
						);
					}
					cx = x;
					cy = y;
					break;
				}
				case 'H':
					cx = num();
					cur?.pts.push(cx, cy);
					break;
				case 'V':
					cy = num();
					cur?.pts.push(cx, cy);
					break;
				default:
					return d;
			}
			if (!Number.isFinite(cx) || !Number.isFinite(cy)) return d;
		}
		flush(i);
	} catch {
		return d;
	}

	const kept = subs.filter((s) => s.area >= minArea);
	if (kept.length === subs.length) return d;
	return kept.map((s) => s.text).join(' ');
}

/** Subconjunto de opções do Potrace usado no traçado de máscara. */
export interface TraceMaskOptions {
	/**
	 * Área mínima (px²) de ilha/furo. Default alto e proporcional à área: numa
	 * SILHUETA não existe detalhe pequeno legítimo — é a defesa mais barata
	 * contra speckle. Quem traça a máscara de GRAVAÇÃO (furos = arte) precisa
	 * passar um valor baixo explícito.
	 */
	turdSize?: number;
	alphaMax?: number;
	optTolerance?: number;
}

interface PotraceTraceParams {
	threshold: number;
	blackOnWhite: boolean;
	background: string;
	optCurve: boolean;
	turdSize: number;
	alphaMax: number;
	optTolerance: number;
}

/**
 * Máscara binária (1 = frente) → `d` compound do Potrace, em px do raster.
 *
 * `background: 'transparent'` é OBRIGATÓRIO: qualquer outra coisa faz o
 * node-potrace emitir um `<rect>` cobrindo 100% do quadro — exatamente o
 * retângulo que este pipeline existe para eliminar. Potrace emite só
 * M/L/C/Z absolutos, então o `d` é seguro pra `scaleAbsolutePathD` e pro
 * parser do svgToDxf (que ignora arcos).
 */
export async function traceMaskToPathD(
	mask: Uint8Array,
	W: number,
	H: number,
	opts: TraceMaskOptions = {},
): Promise<string> {
	const png = await encodeMaskToPng(mask, W, H);
	const params: PotraceTraceParams = {
		threshold: 128,
		blackOnWhite: true,
		background: 'transparent',
		optCurve: true,
		turdSize: opts.turdSize ?? Math.max(16, Math.round(W * H * 2e-5)),
		alphaMax: opts.alphaMax ?? 1,
		optTolerance: opts.optTolerance ?? 0.4,
	};
	const svg = await new Promise<string>((resolve, reject) => {
		Potrace.trace(
			png,
			params as Potrace.PotraceOptions,
			(err: Error | null, out: string) => {
				if (err) return reject(err);
				resolve(out ?? '');
			},
		);
	});
	return svg.match(/\bd="([^"]+)"/)?.[1]?.trim() ?? '';
}

/**
 * Reescreve NUMERICAMENTE um `d` absoluto (M/L/C/H/V/Z): x' = x·sx + tx,
 * y' = y·sy + ty. Lança em comando relativo ou não suportado (Q/S/T/A) — o
 * chamador cai no fallback em vez de emitir geometria errada em silêncio,
 * que é o pior desfecho possível num arquivo de laser.
 */
export function scaleAbsolutePathD(
	d: string,
	sx: number,
	sy: number,
	tx: number,
	ty: number,
): string {
	const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
	let out = '';
	let cmd = '';
	let i = 0;
	const num = () => {
		const v = Number.parseFloat(tokens[i++]);
		if (!Number.isFinite(v)) {
			throw new Error('scaleAbsolutePathD: coordenada inválida');
		}
		return v;
	};
	const round3 = (v: number) => String(Math.round(v * 1000) / 1000);
	const fx = () => round3(num() * sx + tx);
	const fy = () => round3(num() * sy + ty);

	while (i < tokens.length) {
		const t = tokens[i];
		if (/^[a-zA-Z]$/.test(t)) {
			i++;
			if (t === 'Z' || t === 'z') {
				out += 'Z';
				cmd = 'Z';
				continue;
			}
			if (!['M', 'L', 'C', 'H', 'V'].includes(t)) {
				throw new Error(`scaleAbsolutePathD: comando não suportado "${t}"`);
			}
			cmd = t;
			continue;
		}
		// Token numérico: um grupo de coordenadas do comando corrente.
		switch (cmd) {
			case 'M':
				out += `M${fx()} ${fy()}`;
				cmd = 'L'; // pares implícitos após M são lineto (SVG spec)
				break;
			case 'L':
				out += `L${fx()} ${fy()}`;
				break;
			case 'C':
				out += `C${fx()} ${fy()} ${fx()} ${fy()} ${fx()} ${fy()}`;
				break;
			case 'H':
				out += `H${fx()}`;
				break;
			case 'V':
				out += `V${fy()}`;
				break;
			default:
				throw new Error(
					`scaleAbsolutePathD: número sem comando válido ("${cmd}")`,
				);
		}
	}
	return out;
}
