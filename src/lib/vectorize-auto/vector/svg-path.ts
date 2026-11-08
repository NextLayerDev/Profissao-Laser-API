/**
 * Parser + serializer de path SVG (atributo `d`), isomórfico (roda no server e
 * no browser — sem imports de Node).
 *
 * Por que existe: os motores de vetorização (potrace npm local e o upstream da
 * NextLayer) devolvem subpaths que terminam no ponto inicial mas NUNCA emitem
 * `Z`. Para o browser isso é invisível (fill fecha implicitamente), mas o
 * EzCad e outros softwares de laser tratam `M … M …` sem `Z` como UMA polilinha
 * aberta: o hatch liga o fim de um contorno ao início do próximo com retas e
 * preenche "cunhas" atravessando o desenho. Aqui todo `d` vira comandos
 * ABSOLUTOS `M`/`L`/`C` + `Z` explícito — o formato mais conservador que os
 * importadores de laser (EzCad, LightBurn, Corel) leem como curva fechada.
 */

export type Seg =
	| { t: 'L'; x: number; y: number }
	| {
			t: 'C';
			x1: number;
			y1: number;
			x2: number;
			y2: number;
			x: number;
			y: number;
	  };

export interface Subpath {
	/** Ponto inicial (M). */
	x0: number;
	y0: number;
	segs: Seg[];
	/** O `d` original fechou este subpath com Z/z. */
	closed: boolean;
}

/** Matriz 2D no formato SVG [a b c d e f]. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Tolerância (unidades do viewBox) para considerar fim == início. */
export const COINCIDE_EPS = 1e-3;

const TOKEN_RE =
	/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/**
 * Converte um `d` em subpaths com segmentos absolutos (L/C). Cobre a gramática
 * completa: comandos relativos, repetição implícita, H/V, S/T (reflexão do
 * ponto de controle), Q/T (quadrática → cúbica exata) e A (arco → cúbicas).
 * Tokens malformados são ignorados em vez de travar o parser.
 */
export function parsePathD(d: string): Subpath[] {
	const tokens = d.match(TOKEN_RE) || [];
	const subpaths: Subpath[] = [];
	let cur: Subpath | null = null;
	let i = 0;
	let cmd = '';
	let prev = ''; // último comando (maiúsculo) — para reflexão em S/T
	let cx = 0,
		cy = 0; // ponto corrente
	let sx = 0,
		sy = 0; // início do subpath
	let pcx = 0,
		pcy = 0; // último ponto de controle (cúbico)
	let pqx = 0,
		pqy = 0; // último ponto de controle (quadrático)

	const isCmd = (t: string) => t.length === 1 && /[A-Za-z]/.test(t);
	const has = (n: number) => {
		for (let k = 0; k < n; k++) {
			const t = tokens[i + k];
			if (t === undefined || isCmd(t)) return false;
		}
		return true;
	};
	const num = () => parseFloat(tokens[i++]);
	/** Argumentos insuficientes/malformados: pula até o próximo comando. */
	const skip = () => {
		while (i < tokens.length && !isCmd(tokens[i])) i++;
	};

	const start = (x: number, y: number) => {
		cur = { x0: x, y0: y, segs: [], closed: false };
		subpaths.push(cur);
		cx = sx = x;
		cy = sy = y;
	};
	const ensure = () => {
		if (!cur) start(cx, cy);
		return cur!;
	};
	const line = (x: number, y: number) => {
		ensure().segs.push({ t: 'L', x, y });
		cx = x;
		cy = y;
	};
	const cubic = (
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		x: number,
		y: number,
	) => {
		ensure().segs.push({ t: 'C', x1, y1, x2, y2, x, y });
		pcx = x2;
		pcy = y2;
		cx = x;
		cy = y;
	};
	const quad = (qx: number, qy: number, x: number, y: number) => {
		const x1 = cx + (2 / 3) * (qx - cx),
			y1 = cy + (2 / 3) * (qy - cy);
		const x2 = x + (2 / 3) * (qx - x),
			y2 = y + (2 / 3) * (qy - y);
		pqx = qx;
		pqy = qy;
		cubic(x1, y1, x2, y2, x, y);
	};

	while (i < tokens.length) {
		const t = tokens[i];
		if (isCmd(t)) {
			cmd = t;
			i++;
			if (cmd === 'Z' || cmd === 'z') {
				if (cur) (cur as Subpath).closed = true;
				cx = sx;
				cy = sy;
				prev = 'Z';
				// Coordenadas depois de Z sem comando = novo subpath no mesmo ponto (M implícito).
				cmd = 'L';
				continue;
			}
		} else if (!cmd) {
			i++; // número sem comando antes — lixo
			continue;
		} else if (cmd === 'M') {
			cmd = 'L';
		} else if (cmd === 'm') {
			cmd = 'l';
		}

		// Depois de Z, um comando de desenho sem M abre um subpath novo no ponto inicial.
		if (prev === 'Z' && cmd !== 'M' && cmd !== 'm') cur = null;

		const rel = cmd === cmd.toLowerCase();
		const ox = rel ? cx : 0,
			oy = rel ? cy : 0;
		const up = cmd.toUpperCase();

		switch (up) {
			case 'M': {
				if (!has(2)) {
					skip();
					break;
				}
				const x = ox + num(),
					y = oy + num();
				start(x, y);
				break;
			}
			case 'L': {
				if (!has(2)) {
					skip();
					break;
				}
				line(ox + num(), oy + num());
				break;
			}
			case 'H': {
				if (!has(1)) {
					skip();
					break;
				}
				line(ox + num(), cy);
				break;
			}
			case 'V': {
				if (!has(1)) {
					skip();
					break;
				}
				line(cx, oy + num());
				break;
			}
			case 'C': {
				if (!has(6)) {
					skip();
					break;
				}
				const x1 = ox + num(),
					y1 = oy + num(),
					x2 = ox + num(),
					y2 = oy + num(),
					x = ox + num(),
					y = oy + num();
				cubic(x1, y1, x2, y2, x, y);
				break;
			}
			case 'S': {
				if (!has(4)) {
					skip();
					break;
				}
				const rx = prev === 'C' || prev === 'S' ? 2 * cx - pcx : cx;
				const ry = prev === 'C' || prev === 'S' ? 2 * cy - pcy : cy;
				const x2 = ox + num(),
					y2 = oy + num(),
					x = ox + num(),
					y = oy + num();
				cubic(rx, ry, x2, y2, x, y);
				break;
			}
			case 'Q': {
				if (!has(4)) {
					skip();
					break;
				}
				const qx = ox + num(),
					qy = oy + num(),
					x = ox + num(),
					y = oy + num();
				quad(qx, qy, x, y);
				break;
			}
			case 'T': {
				if (!has(2)) {
					skip();
					break;
				}
				const qx = prev === 'Q' || prev === 'T' ? 2 * cx - pqx : cx;
				const qy = prev === 'Q' || prev === 'T' ? 2 * cy - pqy : cy;
				const x = ox + num(),
					y = oy + num();
				quad(qx, qy, x, y);
				break;
			}
			case 'A': {
				if (!has(7)) {
					skip();
					break;
				}
				const rx = num(),
					ry = num(),
					rot = num(),
					fa = num() !== 0,
					fs = num() !== 0;
				const x = ox + num(),
					y = oy + num();
				ensure();
				for (const c of arcToCubics(cx, cy, rx, ry, rot, fa, fs, x, y)) {
					cubic(c[0], c[1], c[2], c[3], c[4], c[5]);
				}
				if (cx !== x || cy !== y) line(x, y); // rx/ry zero ou arco degenerado
				break;
			}
			default:
				i++;
				break;
		}
		prev = up;
	}

	return subpaths;
}

/** Arco elíptico (parametrização endpoint → centro, SVG F.6.5) em cúbicas. */
function arcToCubics(
	x1: number,
	y1: number,
	rx: number,
	ry: number,
	rotDeg: number,
	largeArc: boolean,
	sweep: boolean,
	x2: number,
	y2: number,
): Array<[number, number, number, number, number, number]> {
	if (x1 === x2 && y1 === y2) return [];
	rx = Math.abs(rx);
	ry = Math.abs(ry);
	if (rx === 0 || ry === 0) return [];

	const phi = (rotDeg * Math.PI) / 180;
	const cos = Math.cos(phi),
		sin = Math.sin(phi);
	const dx = (x1 - x2) / 2,
		dy = (y1 - y2) / 2;
	const x1p = cos * dx + sin * dy;
	const y1p = -sin * dx + cos * dy;

	const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
	if (lambda > 1) {
		const s = Math.sqrt(lambda);
		rx *= s;
		ry *= s;
	}

	const rx2 = rx * rx,
		ry2 = ry * ry;
	const numer = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
	const denom = rx2 * y1p * y1p + ry2 * x1p * x1p;
	const coef =
		(largeArc !== sweep ? 1 : -1) *
		Math.sqrt(Math.max(0, denom === 0 ? 0 : numer / denom));
	const cxp = (coef * rx * y1p) / ry;
	const cyp = (coef * -ry * x1p) / rx;
	const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
	const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

	const angle = (ux: number, uy: number, vx: number, vy: number) => {
		const dot = ux * vx + uy * vy;
		const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
		const a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
		return ux * vy - uy * vx < 0 ? -a : a;
	};
	const ux = (x1p - cxp) / rx,
		uy = (y1p - cyp) / ry;
	const vx = (-x1p - cxp) / rx,
		vy = (-y1p - cyp) / ry;
	const theta1 = angle(1, 0, ux, uy);
	let dtheta = angle(ux, uy, vx, vy);
	if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
	if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

	const n = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)));
	const delta = dtheta / n;
	const t = (4 / 3) * Math.tan(delta / 4);
	const map = (ex: number, ey: number): [number, number] => [
		cx + cos * rx * ex - sin * ry * ey,
		cy + sin * rx * ex + cos * ry * ey,
	];

	const out: Array<[number, number, number, number, number, number]> = [];
	for (let k = 0; k < n; k++) {
		const a1 = theta1 + k * delta,
			a2 = a1 + delta;
		const c1 = Math.cos(a1),
			s1 = Math.sin(a1),
			c2 = Math.cos(a2),
			s2 = Math.sin(a2);
		const p1 = map(c1 - t * s1, s1 + t * c1);
		const p2 = map(c2 + t * s2, s2 - t * c2);
		const pe = k === n - 1 ? [x2, y2] : map(c2, s2);
		out.push([p1[0], p1[1], p2[0], p2[1], pe[0], pe[1]]);
	}
	return out;
}

// ─── Transform ───

export function multiply(m: Matrix, n: Matrix): Matrix {
	// m × n (aplica n primeiro, depois m) — mesma semântica da composição do SVG.
	return [
		m[0] * n[0] + m[2] * n[1],
		m[1] * n[0] + m[3] * n[1],
		m[0] * n[2] + m[2] * n[3],
		m[1] * n[2] + m[3] * n[3],
		m[0] * n[4] + m[2] * n[5] + m[4],
		m[1] * n[4] + m[3] * n[5] + m[5],
	];
}

/** Faz o parse de um atributo `transform` (lista de funções, esquerda → direita). */
export function parseTransform(src: string | undefined | null): Matrix {
	let m: Matrix = IDENTITY;
	if (!src) return m;
	const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
	let match: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: laço clássico de RegExp.exec
	while ((match = re.exec(src)) !== null) {
		const fn = match[1];
		const a = match[2]
			.split(/[\s,]+/)
			.filter(Boolean)
			.map(Number);
		if (a.some((v) => !Number.isFinite(v))) continue;
		let t: Matrix | null = null;
		switch (fn) {
			case 'matrix':
				if (a.length === 6) t = [a[0], a[1], a[2], a[3], a[4], a[5]];
				break;
			case 'translate':
				t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
				break;
			case 'scale':
				t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
				break;
			case 'rotate': {
				const r = ((a[0] ?? 0) * Math.PI) / 180;
				const c = Math.cos(r),
					s = Math.sin(r);
				t = [c, s, -s, c, 0, 0];
				if (a.length >= 3) {
					t = multiply(multiply([1, 0, 0, 1, a[1], a[2]], t), [
						1,
						0,
						0,
						1,
						-a[1],
						-a[2],
					]);
				}
				break;
			}
			case 'skewX':
				t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
				break;
			case 'skewY':
				t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
				break;
		}
		if (t) m = multiply(m, t);
	}
	return m;
}

export function isIdentity(m: Matrix): boolean {
	return (
		m[0] === 1 &&
		m[1] === 0 &&
		m[2] === 0 &&
		m[3] === 1 &&
		m[4] === 0 &&
		m[5] === 0
	);
}

export function transformSubpaths(subs: Subpath[], m: Matrix): Subpath[] {
	if (isIdentity(m)) return subs;
	const px = (x: number, y: number) => m[0] * x + m[2] * y + m[4];
	const py = (x: number, y: number) => m[1] * x + m[3] * y + m[5];
	return subs.map((s) => ({
		x0: px(s.x0, s.y0),
		y0: py(s.x0, s.y0),
		closed: s.closed,
		segs: s.segs.map((g) =>
			g.t === 'L'
				? { t: 'L' as const, x: px(g.x, g.y), y: py(g.x, g.y) }
				: {
						t: 'C' as const,
						x1: px(g.x1, g.y1),
						y1: py(g.x1, g.y1),
						x2: px(g.x2, g.y2),
						y2: py(g.x2, g.y2),
						x: px(g.x, g.y),
						y: py(g.x, g.y),
					},
		),
	}));
}

// ─── Serialização ───

/** Número com até 3 casas, sem zeros à direita e sem "-0". */
export function fmt(v: number): string {
	if (!Number.isFinite(v)) return '0';
	const s = v.toFixed(3).replace(/\.?0+$/, '');
	return s === '-0' || s === '' ? '0' : s;
}

function endOf(s: Subpath): [number, number] {
	const last = s.segs[s.segs.length - 1];
	return last ? [last.x, last.y] : [s.x0, s.y0];
}

function coincide(s: Subpath): boolean {
	const [ex, ey] = endOf(s);
	return Math.hypot(ex - s.x0, ey - s.y0) < COINCIDE_EPS;
}

function degenerate(s: Subpath): boolean {
	if (s.segs.length === 0) return true;
	let minX = s.x0,
		maxX = s.x0,
		minY = s.y0,
		maxY = s.y0;
	for (const g of s.segs) {
		const pts =
			g.t === 'L'
				? [[g.x, g.y]]
				: [
						[g.x1, g.y1],
						[g.x2, g.y2],
						[g.x, g.y],
					];
		for (const [x, y] of pts) {
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	}
	return maxX - minX < COINCIDE_EPS && maxY - minY < COINCIDE_EPS;
}

export interface SerializeOptions {
	/** true = path preenchido: TODO subpath é fechado com Z (contorno de área).
	 *  false = só traço: fecha apenas o que já era fechado ou volta ao início
	 *  (linhas abertas de propósito — ex.: dobras/centerline — ficam abertas). */
	filled: boolean;
}

/**
 * Decide se o subpath sai fechado. Exposta para o export DXF/PDF aplicar a
 * mesma regra do SVG normalizado.
 */
export function shouldClose(s: Subpath, filled: boolean): boolean {
	return filled || s.closed || coincide(s);
}

/**
 * Serializa subpaths em `M x y L x y C x1 y1 x2 y2 x y … Z` — absoluto, sem
 * vírgulas, sem comandos relativos. Subpaths degenerados são descartados.
 */
export function serializeSubpaths(
	subs: Subpath[],
	opts: SerializeOptions,
): string {
	const parts: string[] = [];
	for (const s of subs) {
		if (degenerate(s)) continue;
		const close = shouldClose(s, opts.filled);
		let segs = s.segs;
		// `L` de volta ao início é redundante com Z (e vira vértice duplicado no DXF).
		if (
			close &&
			coincide(s) &&
			segs.length > 1 &&
			segs[segs.length - 1].t === 'L'
		) {
			segs = segs.slice(0, -1);
		}
		let out = `M${fmt(s.x0)} ${fmt(s.y0)}`;
		for (const g of segs) {
			out +=
				g.t === 'L'
					? `L${fmt(g.x)} ${fmt(g.y)}`
					: `C${fmt(g.x1)} ${fmt(g.y1)} ${fmt(g.x2)} ${fmt(g.y2)} ${fmt(g.x)} ${fmt(g.y)}`;
		}
		if (close) out += 'Z';
		parts.push(out);
	}
	return parts.join('');
}

/** Atalho: normaliza um `d` isolado (sem transform). */
export function normalizePathD(d: string, filled = true): string {
	return serializeSubpaths(parsePathD(d), { filled });
}
