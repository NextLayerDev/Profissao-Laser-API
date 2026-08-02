/**
 * Nesting (encaixe de peças na chapa) por MaxRects-BSSF.
 *
 * MaxRects mantém uma lista de retângulos LIVRES que podem se sobrepor entre si
 * — cada um é uma região máxima ainda vazia. A cada peça colocada, todo livre
 * que a peça cruza é recortado em até 4 novos livres, e os que ficaram contidos
 * em outro são podados. BSSF (Best Short Side Fit) escolhe o livre que deixa a
 * MENOR sobra no lado mais apertado: encosta a peça no canto mais justo em vez
 * de estragar um retângulo grande.
 *
 * Módulo PURO: só `ir.ts`, `tool-errors.ts` e Node built-ins.
 */

import { ToolEngineError } from '../tool-errors.js';
import {
	arcFromBulge,
	bboxOf,
	type CadPath,
	type NestResult,
	type Part,
	type Placement,
	type Sheet,
	sweepFromBulge,
} from './ir.js';

/**
 * Tolerância de comparação em mm. O EPS de `ir.ts` (1e-9) é justo demais aqui:
 * as somas de gap/margem ao longo de uma chapa acumulam erro bem acima disso e
 * uma peça que cabe exatamente seria recusada.
 */
const NEST_EPS = 1e-6;

/** Distância mínima entre peças, em mm. */
export const GAP_MINIMO = 1.5;

/** Faixa morta da borda da chapa, em mm (garras, deformação, borda irregular). */
export const MARGEM_PADRAO = 5;

export interface NestOptions {
	/** Kerf em mm — usado só para derivar o gap padrão. */
	kerf?: number;
	/** Sobrepõe o gap derivado do kerf. */
	gap?: number;
	/** Sobrepõe a margem padrão. */
	margin?: number;
	/**
	 * Permite girar a peça 90° (default `true`). Desligue quando o material tem
	 * direção — veio do compensado, filme protetor do acrílico, textura impressa:
	 * a peça girada continua cabendo na chapa, mas sai com o veio atravessado.
	 */
	rotate?: boolean;
}

/**
 * Dois cortes encostados compartilham material: o feixe da segunda passada
 * invade a peça já cortada, que solta e tomba antes da hora, e a borda queima.
 * Por isso o vão entre peças é 2 kerfs (um para cada corte) e nunca menos que
 * 1,5 mm — abaixo disso a chapa vibra e a ponte de material quebra sozinha.
 */
export function gapFromKerf(kerf: number): number {
	return Math.max(2 * kerf, GAP_MINIMO);
}

interface FreeRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

interface Instancia {
	partId: string;
	instance: number;
	/** Largura do footprint sem rotação. */
	w: number;
	/** Altura do footprint sem rotação. */
	h: number;
	/** Área real do contorno (shoelace), para o cálculo de aproveitamento. */
	area: number;
}

interface Encaixe {
	chapa: number;
	x: number;
	y: number;
	rot: 0 | 90;
	/** Footprint já orientado, sem o gap. */
	w: number;
	h: number;
}

// ---------------------------------------------------------------------------
// Área real da peça
// ---------------------------------------------------------------------------

/**
 * Área fechada por um caminho, ou `null` se ele não fecha região nenhuma.
 * Shoelace nos vértices + a correção do segmento circular de cada bulge
 * (`r²/2·(Δθ − senΔθ)`, a área entre o arco e a corda).
 */
function areaFechada(path: CadPath): number | null {
	const s = path.seg;
	if (s.k === 'circle') return Math.PI * s.r * s.r;
	if (s.k !== 'poly' || !s.closed) return null;
	const pts = s.pts;
	const n = pts.length;
	if (n < 3) return null;

	let dobro = 0;
	for (let i = 0; i < n; i++) {
		const p1 = pts[i];
		const p2 = pts[(i + 1) % n];
		dobro += p1.x * p2.y - p2.x * p1.y;
	}
	let area = dobro / 2;

	// A correção do arco tem que seguir a ORIENTAÇÃO do contorno: num polígono
	// horário a área com sinal é negativa, e um bojo para fora precisa deixá-la
	// mais negativa, não menos. Sem este sinal, canto arredondado em contorno
	// horário devolve área maior que a do retângulo que o contém.
	const orient = area >= 0 ? 1 : -1;
	for (let i = 0; i < n; i++) {
		const b = s.bulges?.[i] ?? 0;
		if (Math.abs(b) < NEST_EPS) continue;
		const arc = arcFromBulge(pts[i], pts[(i + 1) % n], b);
		if (!arc) continue;
		const sweep = sweepFromBulge(b);
		area += orient * ((arc.r * arc.r) / 2) * (sweep - Math.sin(sweep));
	}
	return Math.abs(area);
}

/**
 * Área que a peça realmente ocupa na chapa: o MAIOR contorno fechado de CORTE.
 * Furos NÃO são descontados — o vazio interno continua sendo chapa reservada,
 * nada é encaixado lá dentro. Sem contorno fechado (peça só de traços abertos),
 * cai na bbox.
 */
export function partArea(part: Part, bboxW: number, bboxH: number): number {
	let maior = 0;
	for (const path of part.paths) {
		if (path.layer !== 'CORTE') continue;
		const a = areaFechada(path);
		if (a !== null && a > maior) maior = a;
	}
	return maior > 0 ? maior : bboxW * bboxH;
}

// ---------------------------------------------------------------------------
// MaxRects
// ---------------------------------------------------------------------------

/** Recorta `livre` tirando `usado`; devolve os pedaços máximos que sobram. */
function splitFree(livre: FreeRect, usado: FreeRect): FreeRect[] {
	const semSobreposicao =
		usado.x >= livre.x + livre.w - NEST_EPS ||
		usado.x + usado.w <= livre.x + NEST_EPS ||
		usado.y >= livre.y + livre.h - NEST_EPS ||
		usado.y + usado.h <= livre.y + NEST_EPS;
	if (semSobreposicao) return [livre];

	const out: FreeRect[] = [];
	// Esquerda
	if (usado.x > livre.x + NEST_EPS) {
		out.push({ x: livre.x, y: livre.y, w: usado.x - livre.x, h: livre.h });
	}
	// Direita
	if (usado.x + usado.w < livre.x + livre.w - NEST_EPS) {
		out.push({
			x: usado.x + usado.w,
			y: livre.y,
			w: livre.x + livre.w - (usado.x + usado.w),
			h: livre.h,
		});
	}
	// Abaixo
	if (usado.y > livre.y + NEST_EPS) {
		out.push({ x: livre.x, y: livre.y, w: livre.w, h: usado.y - livre.y });
	}
	// Acima
	if (usado.y + usado.h < livre.y + livre.h - NEST_EPS) {
		out.push({
			x: livre.x,
			y: usado.y + usado.h,
			w: livre.w,
			h: livre.y + livre.h - (usado.y + usado.h),
		});
	}
	return out;
}

function contido(a: FreeRect, b: FreeRect): boolean {
	return (
		a.x >= b.x - NEST_EPS &&
		a.y >= b.y - NEST_EPS &&
		a.x + a.w <= b.x + b.w + NEST_EPS &&
		a.y + a.h <= b.y + b.h + NEST_EPS
	);
}

/**
 * Poda: livres degenerados e livres contidos em outro. Sem isso a lista cresce
 * sem limite e o BSSF passa a escolher retângulos que são só duplicata de um
 * vizinho maior.
 */
function podar(livres: FreeRect[]): FreeRect[] {
	const validos = livres.filter((r) => r.w > NEST_EPS && r.h > NEST_EPS);
	const out: FreeRect[] = [];
	for (let i = 0; i < validos.length; i++) {
		let engolido = false;
		for (let j = 0; j < validos.length && !engolido; j++) {
			if (i === j) continue;
			// Em empate exato (retângulos iguais) só o de menor índice sobrevive.
			if (
				contido(validos[i], validos[j]) &&
				(j < i || !contido(validos[j], validos[i]))
			) {
				engolido = true;
			}
		}
		if (!engolido) out.push(validos[i]);
	}
	return out;
}

// ---------------------------------------------------------------------------
// nestParts
// ---------------------------------------------------------------------------

/**
 * Distribui as peças (já multiplicadas por `qty`) em quantas chapas forem
 * necessárias.
 *
 * Convenções do resultado:
 * - `Placement.x/y` é o canto inferior-esquerdo da bbox da peça, em coordenadas
 *   da chapa (mm, Y para cima); `rot: 90` significa que o footprint virou h × w.
 * - `instance` é 0-based dentro da peça.
 * - `unplaced` traz UM id por instância que não coube, então `unplaced.length`
 *   é a contagem de peças perdidas (ids repetem quando `qty > 1`).
 * - `utilization[i]` usa a área real do contorno, não a da bbox: bbox de peça
 *   redonda ou em L mente para mais e faria o aproveitamento parecer ótimo.
 */
export function nestParts(
	parts: Part[],
	chapa: { w: number; h: number },
	opts: NestOptions = {},
): NestResult {
	const margin = opts.margin ?? MARGEM_PADRAO;
	const gap = opts.gap ?? gapFromKerf(opts.kerf ?? 0);
	const rotacoes: readonly (0 | 90)[] = opts.rotate === false ? [0] : [0, 90];

	if (!(chapa.w > 0) || !(chapa.h > 0)) {
		throw new ToolEngineError(
			400,
			'Dimensões da chapa inválidas. Informe largura e altura maiores que zero.',
		);
	}
	if (!(margin >= 0) || !(gap >= 0)) {
		throw new ToolEngineError(
			400,
			'Margem e espaçamento entre peças não podem ser negativos.',
		);
	}

	const utilW = chapa.w - 2 * margin;
	const utilH = chapa.h - 2 * margin;
	if (utilW <= NEST_EPS || utilH <= NEST_EPS) {
		throw new ToolEngineError(
			400,
			`A margem de ${margin} mm não deixa área útil numa chapa de ${chapa.w} × ${chapa.h} mm. ` +
				'Reduza a margem ou use uma chapa maior.',
		);
	}

	// Expande por qty e mede cada peça uma vez só.
	const instancias: Instancia[] = [];
	for (const part of parts) {
		const qty = Math.max(0, Math.round(part.qty));
		if (qty === 0) continue;
		let w = part.bbox?.w ?? 0;
		let h = part.bbox?.h ?? 0;
		if (!(w > 0) || !(h > 0)) {
			// bbox não preenchida pelo gerador: recalcula a partir da geometria.
			const b = bboxOf(part.paths);
			w = b.w;
			h = b.h;
		}
		const area = partArea(part, w, h);
		for (let i = 0; i < qty; i++) {
			instancias.push({ partId: part.id, instance: i, w, h, area });
		}
	}

	// Maior primeiro: as peças grandes precisam da chapa ainda inteira; deixá-las
	// para o fim garante chapa nova só para elas. Desempate pelo maior lado, que
	// é a dimensão que de fato limita onde a peça pode entrar.
	instancias.sort((a, b) => {
		const da = b.w * b.h - a.w * a.h;
		if (Math.abs(da) > NEST_EPS) return da;
		return Math.max(b.w, b.h) - Math.max(a.w, a.h);
	});

	const sheets: Sheet[] = [];
	const livresPorChapa: FreeRect[][] = [];
	const areaPorChapa: number[] = [];
	const unplaced: string[] = [];

	/**
	 * O livre inicial é a área útil ESTICADA de um gap. Truque que evita o erro
	 * clássico de desperdiçar um gap contra a borda: como toda peça é reservada
	 * com w+gap × h+gap, a última peça de cada fileira "gasta" um gap que não
	 * existe fisicamente; esticar o retângulo inicial devolve exatamente esse
	 * gap e faz a peça encostada na margem fechar em `chapa − margin`.
	 */
	const novaChapa = (): void => {
		sheets.push({ w: chapa.w, h: chapa.h, placements: [] });
		livresPorChapa.push([
			{ x: margin, y: margin, w: utilW + gap, h: utilH + gap },
		]);
		areaPorChapa.push(0);
	};

	const cabeNaUtil = (inst: Instancia): boolean =>
		(inst.w <= utilW + NEST_EPS && inst.h <= utilH + NEST_EPS) ||
		(rotacoes.includes(90) &&
			inst.h <= utilW + NEST_EPS &&
			inst.w <= utilH + NEST_EPS);

	const buscar = (inst: Instancia, apenasChapa?: number): Encaixe | null => {
		let melhor: Encaixe | null = null;
		let melhorCurto = Number.POSITIVE_INFINITY;
		let melhorLongo = Number.POSITIVE_INFINITY;
		const de = apenasChapa ?? 0;
		const ate = apenasChapa ?? sheets.length - 1;
		for (let s = de; s <= ate; s++) {
			for (const livre of livresPorChapa[s]) {
				for (const rot of rotacoes) {
					const pw = (rot === 0 ? inst.w : inst.h) + gap;
					const ph = (rot === 0 ? inst.h : inst.w) + gap;
					if (pw > livre.w + NEST_EPS || ph > livre.h + NEST_EPS) continue;
					const sobraW = livre.w - pw;
					const sobraH = livre.h - ph;
					const curto = Math.min(sobraW, sobraH);
					const longo = Math.max(sobraW, sobraH);
					const ganha =
						curto < melhorCurto - NEST_EPS ||
						(curto < melhorCurto + NEST_EPS && longo < melhorLongo - NEST_EPS);
					if (!ganha) continue;
					melhorCurto = curto;
					melhorLongo = longo;
					melhor = {
						chapa: s,
						x: livre.x,
						y: livre.y,
						rot,
						w: pw - gap,
						h: ph - gap,
					};
				}
			}
		}
		return melhor;
	};

	const aplicar = (inst: Instancia, e: Encaixe): void => {
		const usado: FreeRect = {
			x: e.x,
			y: e.y,
			w: e.w + gap,
			h: e.h + gap,
		};
		const novos: FreeRect[] = [];
		for (const livre of livresPorChapa[e.chapa])
			novos.push(...splitFree(livre, usado));
		livresPorChapa[e.chapa] = podar(novos);
		const placement: Placement = {
			partId: inst.partId,
			instance: inst.instance,
			x: e.x,
			y: e.y,
			rot: e.rot,
		};
		sheets[e.chapa].placements.push(placement);
		areaPorChapa[e.chapa] += inst.area;
	};

	for (const inst of instancias) {
		if (!cabeNaUtil(inst)) {
			// Não cabe nem sozinha numa chapa virgem, em nenhuma das duas orientações.
			unplaced.push(inst.partId);
			continue;
		}
		let encaixe = sheets.length > 0 ? buscar(inst) : null;
		if (!encaixe) {
			novaChapa();
			encaixe = buscar(inst, sheets.length - 1);
		}
		// Chapa virgem tem a área útil inteira livre e `cabeNaUtil` já passou, então
		// `encaixe` é sempre não-nulo aqui; a guarda existe só para nunca cair em
		// laço infinito abrindo chapa atrás de chapa se algum invariante mudar.
		if (!encaixe) {
			unplaced.push(inst.partId);
			continue;
		}
		aplicar(inst, encaixe);
	}

	const areaChapa = chapa.w * chapa.h;
	const utilization = areaPorChapa.map((a) => Math.min(1, a / areaChapa));

	return { sheets, utilization, unplaced, gap, margin };
}
