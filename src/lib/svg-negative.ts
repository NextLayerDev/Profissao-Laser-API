import sharp from 'sharp';
import { readSvgGeometry } from './svg-invert.js';
import { rasterizeSvgToInkMask } from './svg-raster.js';

// ─────────────────────────────────────────────────────────────────────
// SILHUETA — máscara sólida do contorno externo do assunto (usada pelo modo
// `silhouette` do Inverter, ver `svg-silhouette-contour.ts`).
//
//   1. máscara de tinta (a partir do SVG já aprovado, não da foto original)
//   2. silhueta sólida = close (funde traços) + fill-holes (preenche o miolo)
//   3. borda = dilata a silhueta
//
// Histórico: essa máscara já alimentou duas ideias ABANDONADAS: (1) um
// "negativo de gravação" vetorial (compound path = contorno da silhueta
// MENOS a arte original como furos, even-odd) que vazava em formas finas/
// diagonais; (2) uma silhueta sólida chapada (preenchia a forma toda de uma
// cor, sem detalhe interno) — o usuário rejeitou por perder o desenho
// original. Consumidores ATUAIS: `buildSilhouetteContourSvg`
// (`svg-silhouette-contour.ts`), que usa a máscara como CRITÉRIO de "que
// pixel inverter" (negativo local, multi-componente aceito) e como contorno
// fino traçado; e `invertSvgBoundedBySilhouette` (`svg-invert-bounded.ts`),
// que usa a máscara dilatada como MOLDURA do complemento geométrico no
// lugar do retângulo do viewBox.
// ─────────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) =>
	v < lo ? lo : v > hi ? hi : v;

/**
 * Morfologia SEPARÁVEL com janela corrente.
 *
 * Dilatar repetidamente por 3×3 com raio r ≡ dilatar uma vez por quadrado
 * (2r+1)², que é separável em uma passada horizontal e uma vertical. Numa
 * máscara 0/1, a contagem corrente na janela dá dilate = `count > 0` e
 * erode = `count === 2r+1`.
 *
 * Isso não é micro-otimização: a versão ingênua (O(9·N) por passada, r vezes) a
 * 1200² com r=14 dá ~330M iterações de loop aninhado em JS — vários segundos
 * dentro do request. Aqui é O(N) por eixo e INDEPENDENTE de r.
 *
 * Fora dos limites conta como fundo, então erode zera nas bordas — igual ao
 * 3×3 repetido.
 */
function morphH(
	src: Uint8Array,
	W: number,
	H: number,
	r: number,
	dilate: boolean,
): Uint8Array {
	const out = new Uint8Array(W * H);
	const win = 2 * r + 1;
	for (let y = 0; y < H; y++) {
		const row = y * W;
		let count = 0;
		for (let k = 0; k <= Math.min(r, W - 1); k++) count += src[row + k];
		for (let x = 0; x < W; x++) {
			out[row + x] = dilate ? (count > 0 ? 1 : 0) : count === win ? 1 : 0;
			const rem = x - r;
			if (rem >= 0) count -= src[row + rem];
			const add = x + 1 + r;
			if (add < W) count += src[row + add];
		}
	}
	return out;
}

function morphV(
	src: Uint8Array,
	W: number,
	H: number,
	r: number,
	dilate: boolean,
): Uint8Array {
	const out = new Uint8Array(W * H);
	const win = 2 * r + 1;
	for (let x = 0; x < W; x++) {
		let count = 0;
		for (let k = 0; k <= Math.min(r, H - 1); k++) count += src[k * W + x];
		for (let y = 0; y < H; y++) {
			out[y * W + x] = dilate ? (count > 0 ? 1 : 0) : count === win ? 1 : 0;
			const rem = y - r;
			if (rem >= 0) count -= src[rem * W + x];
			const add = y + 1 + r;
			if (add < H) count += src[add * W + x];
		}
	}
	return out;
}

/** Dilatação por quadrado (2r+1)². */
export function dilateSquare(
	m: Uint8Array,
	W: number,
	H: number,
	r: number,
): Uint8Array {
	if (r <= 0) return Uint8Array.from(m);
	return morphV(morphH(m, W, H, r, true), W, H, r, true);
}

/** Erosão por quadrado (2r+1)². */
export function erodeSquare(
	m: Uint8Array,
	W: number,
	H: number,
	r: number,
): Uint8Array {
	if (r <= 0) return Uint8Array.from(m);
	return morphV(morphH(m, W, H, r, false), W, H, r, false);
}

/** Close = dilate seguido de erode: funde traços próximos sem crescer a forma. */
export function closeSquare(
	m: Uint8Array,
	W: number,
	H: number,
	r: number,
): Uint8Array {
	return erodeSquare(dilateSquare(m, W, H, r), W, H, r);
}

/**
 * Preenche os buracos internos: inunda o fundo a partir das bordas; todo fundo
 * não alcançado está cercado por frente → vira frente (miolo da figura).
 * Pilha pré-alocada (Int32Array) — a versão com `number[]` realoca muito.
 */
export function fillHoles(fg: Uint8Array, W: number, H: number): Uint8Array {
	const N = W * H;
	const reach = new Uint8Array(N);
	const stack = new Int32Array(N);
	let sp = 0;
	const pushIfBg = (i: number) => {
		if (fg[i] === 0 && reach[i] === 0) {
			reach[i] = 1;
			stack[sp++] = i;
		}
	};
	for (let x = 0; x < W; x++) {
		pushIfBg(x);
		pushIfBg((H - 1) * W + x);
	}
	for (let y = 0; y < H; y++) {
		pushIfBg(y * W);
		pushIfBg(y * W + (W - 1));
	}
	while (sp > 0) {
		const i = stack[--sp];
		const x = i % W;
		const y = (i / W) | 0;
		if (x > 0) pushIfBg(i - 1);
		if (x < W - 1) pushIfBg(i + 1);
		if (y > 0) pushIfBg(i - W);
		if (y < H - 1) pushIfBg(i + W);
	}
	const out = Uint8Array.from(fg);
	for (let i = 0; i < N; i++) if (fg[i] === 0 && reach[i] === 0) out[i] = 1;
	return out;
}

/**
 * Sela a silhueta contra as bordas da imagem. Quando a figura é CORTADA pelo
 * enquadramento (ex.: retrato com o busto saindo por baixo), o contorno não
 * existe na linha do corte e o flood-fill do `fillHoles` entra pelos vãos das
 * hachuras — o miolo não preenche e o fechamento falha embaixo.
 *
 * Duas passadas por borda: (1) escora — posição da borda com tinta a até
 * `depth` px preenche da borda até a tinta; (2) ponte — vãos de até `gap` px
 * entre escoras na linha da borda são preenchidos. Arte com margem real em
 * volta (> depth) não é afetada.
 */
/**
 * Distância da borda em que a tinta conta como "genuinamente cortada".
 *
 * O selo existe para figura que o enquadramento CORTA — sem ele o flood-fill
 * vaza pelos vãos da hachura. Mas o critério original ("tinta a menos de
 * `depth`", até 60px) dispara também quando existe margem: aí ele escora as 4
 * bordas, o `fillHoles` preenche tudo e a silhueta vira o QUADRO INTEIRO —
 * um retângulo preto no lugar do contorno da figura.
 */
const TOUCH_PX = 2;

export function sealAgainstEdges(
	ink: Uint8Array,
	W: number,
	H: number,
	depth: number,
	gap: number,
): Uint8Array {
	const out = Uint8Array.from(ink);
	/** A arte alcança esta borda de fato? Só então faz sentido escorá-la. */
	const touches = (len: number, idx: (pos: number, d: number) => number) => {
		for (let pos = 0; pos < len; pos++) {
			for (let d = 0; d < TOUCH_PX; d++) {
				if (ink[idx(pos, d)] === 1) return true;
			}
		}
		return false;
	};
	const sealEdge = (len: number, idx: (pos: number, d: number) => number) => {
		if (!touches(len, idx)) return;
		for (let pos = 0; pos < len; pos++) {
			for (let d = 0; d < depth; d++) {
				if (ink[idx(pos, d)] === 1) {
					for (let dd = 0; dd < d; dd++) out[idx(pos, dd)] = 1;
					break;
				}
			}
		}
		let last = -1;
		for (let pos = 0; pos < len; pos++) {
			if (out[idx(pos, 0)] !== 1) continue;
			if (last >= 0 && pos - last > 1 && pos - last - 1 <= gap) {
				for (let p = last + 1; p < pos; p++) out[idx(p, 0)] = 1;
			}
			last = pos;
		}
	};
	sealEdge(W, (x, d) => (H - 1 - d) * W + x); // baixo
	sealEdge(W, (x, d) => d * W + x); // cima
	sealEdge(H, (y, d) => y * W + (W - 1 - d)); // direita
	sealEdge(H, (y, d) => y * W + d); // esquerda
	return out;
}

/** Menor distância entre a tinta e qualquer borda (px) — a margem disponível. */
function inkMarginToBorder(ink: Uint8Array, W: number, H: number): number {
	let best = Math.min(W, H);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			if (ink[y * W + x] !== 1) continue;
			const d = Math.min(x, y, W - 1 - x, H - 1 - y);
			if (d < best) best = d;
			if (best === 0) return 0;
		}
	}
	return best;
}

export interface NegativeOptions {
	/** Espessura da borda da silhueta em px (default: ~1.8% da menor dimensão). */
	border?: number;
	/** Lado maior do raster de trabalho. */
	workDim?: number;
	/**
	 * Override do raio de fechamento (default: ~1% da menor dimensão, 1-6px).
	 * Formas finas/diagonais (ex.: mechas de cabelo) podem precisar de um raio
	 * maior pra fechar sem deixar vão — usado pela retentativa de
	 * `buildSilhouetteContourSvg` quando o detector de vazamento dispara.
	 */
	closeR?: number;
}

/**
 * Silhueta sólida (1 = dentro da figura), a partir de uma máscara de tinta já
 * rasterizada: close (funde traços) → sela contra bordas (figura cortada pelo
 * enquadramento) → preenche o miolo → dilata a borda.
 *
 * Função pura, sem I/O — separada de `silhouetteMaskPng` pra quem precisa da
 * máscara de tinta ORIGINAL além do resultado (ex.: detectar vazamento
 * comparando a tinta com o contorno traçado).
 */
export function computeSilhouetteMask(
	ink: Uint8Array,
	W: number,
	H: number,
	opts: NegativeOptions = {},
): Uint8Array {
	const minDim = Math.min(W, H);
	// Teto alto de propósito: o default (~1% de minDim) fica bem abaixo dele
	// sempre; quem precisa do teto alto é a retentativa de
	// `buildSilhouetteContourSvg` (multiplica o raio pra fechar vãos diagonais
	// que a primeira passada deixou abertos) — um teto baixo aqui anularia esse
	// multiplicador silenciosamente.
	const closeR = clamp(opts.closeR ?? Math.round(minDim * 0.01), 1, 40);
	const sealDepth = clamp(Math.round(minDim * 0.05), 4, 60);
	const sealGap = clamp(Math.round(minDim * 0.04), 4, 48);
	const freeMargin = inkMarginToBorder(ink, W, H);
	const borderR = Math.min(
		clamp(opts.border ?? Math.round(minDim * 0.018), 2, 14),
		Math.floor(freeMargin / 2),
	);

	let sil = closeSquare(ink, W, H, closeR);
	sil = sealAgainstEdges(sil, W, H, sealDepth, sealGap);
	sil = fillHoles(sil, W, H);
	sil = dilateSquare(sil, W, H, borderR);
	return sil;
}

export interface BboxSealResult {
	sealed: Uint8Array;
	/** Arestas do bbox onde o ASSUNTO é cortado pelo enquadramento. */
	cropped: { top: boolean; bottom: boolean; left: boolean; right: boolean };
	bbox: { x0: number; y0: number; x1: number; y1: number } | null;
}

/**
 * Sela a tinta contra as arestas do BBOX DO CONTEÚDO — a borda original da
 * foto antes da margem do padForTrace (que deixou o `sealAgainstEdges` da
 * imagem inteira morto: a tinta nunca toca a borda). Uma aresta só é selada
 * quando uma fração relevante dela tem tinta encostada (`minCoverage`) —
 * i.e., o assunto é genuinamente CORTADO ali (busto saindo por baixo). Sem
 * isso, área clara do assunto encostada no corte (camiseta estourada) é
 * porta de entrada do flood e vira buraco branco no negativo.
 */
export function sealAgainstBboxEdges(
	ink: Uint8Array,
	W: number,
	H: number,
	opts: { band?: number; minCoverage?: number } = {},
): BboxSealResult {
	const band = opts.band ?? 8;
	const minCoverage = opts.minCoverage ?? 0.2;
	let x0 = W;
	let y0 = H;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < H; y++) {
		const row = y * W;
		for (let x = 0; x < W; x++) {
			if (ink[row + x] !== 1) continue;
			if (x < x0) x0 = x;
			if (x > x1) x1 = x;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
		}
	}
	const cropped = { top: false, bottom: false, left: false, right: false };
	if (x1 < 0) return { sealed: Uint8Array.from(ink), cropped, bbox: null };

	const out = Uint8Array.from(ink);
	const minDim = Math.min(W, H);
	const depth = clamp(Math.round(minDim * 0.05), 4, 60);
	const gap = clamp(Math.round(minDim * 0.04), 4, 48);

	/** Sela uma aresta: `idx(pos, d)` anda da linha da aresta pra dentro. */
	const sealEdge = (
		len: number,
		idx: (pos: number, d: number) => number,
	): boolean => {
		let touching = 0;
		for (let pos = 0; pos < len; pos++) {
			for (let d = 0; d < band; d++) {
				if (ink[idx(pos, d)] === 1) {
					touching++;
					break;
				}
			}
		}
		if (touching / len < minCoverage) return false;
		// Escora: da linha da aresta até a primeira tinta (a até `depth`).
		for (let pos = 0; pos < len; pos++) {
			for (let d = 0; d < depth; d++) {
				if (ink[idx(pos, d)] === 1) {
					for (let dd = 0; dd < d; dd++) out[idx(pos, dd)] = 1;
					break;
				}
			}
		}
		// Ponte: vãos de até `gap` na linha da aresta.
		let last = -1;
		for (let pos = 0; pos < len; pos++) {
			if (out[idx(pos, 0)] !== 1) continue;
			if (last >= 0 && pos - last > 1 && pos - last - 1 <= gap) {
				for (let p = last + 1; p < pos; p++) out[idx(p, 0)] = 1;
			}
			last = pos;
		}
		return true;
	};

	const bw = x1 - x0 + 1;
	const bh = y1 - y0 + 1;
	cropped.top = sealEdge(bw, (p, d) => (y0 + d) * W + (x0 + p));
	cropped.bottom = sealEdge(bw, (p, d) => (y1 - d) * W + (x0 + p));
	cropped.left = sealEdge(bh, (p, d) => (y0 + p) * W + (x0 + d));
	cropped.right = sealEdge(bh, (p, d) => (y0 + p) * W + (x1 - d));
	return { sealed: out, cropped, bbox: { x0, y0, x1, y1 } };
}

export interface PocketOptions {
	/** Raio do fechamento mais forte que "testa" se o bolsão fecharia. */
	closeR: number;
	/** Área máxima de um bolsão absorvível, como fração da tela. */
	maxAreaFraction?: number;
	/** Fração máxima do perímetro do bolsão que pode dar pro fundo aberto. */
	maxOpenFraction?: number;
	/**
	 * Exige que o bolsão contenha ILHA de silhueta (desenho flutuando dentro
	 * dele, sem tocar as paredes). Separa "interior do assunto com traço
	 * esparso" (ex.: peito de desenho a lápis com logos soltos — absorve) de
	 * "vão vazio entre elementos separados" (ex.: espaçamento entre troféus
	 * numa arte 360° — preserva). Medido: área e abertura NÃO separam esses
	 * dois casos (5%/3% vs 4,2%/6%); a presença de ilhas separa.
	 */
	requireInkIsland?: boolean;
}

/**
 * Absorve BOLSÕES de fundo na silhueta: regiões que só não são buraco porque
 * escapam por um canal estreito entre traços (ex.: o vão entre a letra, a
 * barra e o contorno fino da placa de um logo — o contorno traçado tem
 * falhas e o flood do `fillHoles` vaza por elas, deixando "pedaços brancos"
 * dentro do campo invertido).
 *
 * Critério em duas partes, pra NÃO engolir vales legítimos (ex.: os vãos
 * entre as penas de um mascote, que devem ficar fora do campo):
 *   1. fecharia sob um close mais forte (`closeR`) — i.e., o canal de escape
 *      é estreito; e
 *   2. o perímetro do bolsão é quase todo murado pela silhueta original
 *      (`maxOpenFraction`) — um vale tem a boca aberta pro fundo (a fração
 *      aberta é a ponte do close, não parede de verdade).
 * Componentes grandes (`maxAreaFraction`) nunca são absorvidos.
 */
export function absorbEnclosedPockets(
	sil: Uint8Array,
	W: number,
	H: number,
	opts: PocketOptions,
): Uint8Array {
	const N = W * H;
	const maxArea = Math.round(N * (opts.maxAreaFraction ?? 0.02));
	const maxOpen = opts.maxOpenFraction ?? 0.15;

	const filled = fillHoles(closeSquare(sil, W, H, opts.closeR), W, H);
	// Candidatos: viraram frente sob o close forte, mas não são silhueta.
	const cand = new Uint8Array(N);
	let candCount = 0;
	for (let i = 0; i < N; i++) {
		if (filled[i] === 1 && sil[i] === 0) {
			cand[i] = 1;
			candCount++;
		}
	}
	if (candCount === 0) return sil;

	// Passo 1: componentes dos candidatos (tamanho, abertura do perímetro).
	const label = new Int32Array(N).fill(-1);
	const stack = new Int32Array(N);
	const pixelsBySeed = new Map<number, number[]>();
	const okBySeed = new Set<number>();
	for (let seed = 0; seed < N; seed++) {
		if (cand[seed] !== 1 || label[seed] >= 0) continue;
		let sp = 0;
		let size = 0;
		let sealed = 0;
		let open = 0;
		const comp: number[] = [];
		stack[sp++] = seed;
		label[seed] = seed;
		while (sp > 0) {
			const i = stack[--sp];
			size++;
			if (size <= maxArea) comp.push(i);
			const x = i % W;
			const y = (i / W) | 0;
			const nb = [
				x > 0 ? i - 1 : -1,
				x < W - 1 ? i + 1 : -1,
				y > 0 ? i - W : -1,
				y < H - 1 ? i + W : -1,
			];
			for (const j of nb) {
				if (j < 0) {
					open++; // borda da imagem conta como fundo aberto
					continue;
				}
				if (cand[j] === 1) {
					if (label[j] < 0) {
						label[j] = seed;
						stack[sp++] = j;
					}
				} else if (sil[j] === 1) {
					sealed++;
				} else {
					open++;
				}
			}
		}
		const openFrac = open / Math.max(1, open + sealed);
		if (size <= maxArea && openFrac <= maxOpen) {
			okBySeed.add(seed);
			pixelsBySeed.set(seed, comp);
		}
	}
	if (okBySeed.size === 0) return sil;

	// Passo 2 (opcional): quais bolsões contêm ILHA de silhueta — um
	// componente de sil cujos vizinhos não-sil estão TODOS dentro de
	// candidatos (não toca o fundo aberto nem a borda).
	if (opts.requireInkIsland) {
		const silLabel = new Int32Array(N).fill(-1);
		const hasIsland = new Set<number>();
		for (let seed = 0; seed < N; seed++) {
			if (sil[seed] !== 1 || silLabel[seed] >= 0) continue;
			let sp = 0;
			let touchesOpen = false;
			const candSeeds = new Set<number>();
			stack[sp++] = seed;
			silLabel[seed] = seed;
			while (sp > 0) {
				const i = stack[--sp];
				const x = i % W;
				const y = (i / W) | 0;
				const nb = [
					x > 0 ? i - 1 : -1,
					x < W - 1 ? i + 1 : -1,
					y > 0 ? i - W : -1,
					y < H - 1 ? i + W : -1,
				];
				for (const j of nb) {
					if (j < 0) {
						touchesOpen = true;
						continue;
					}
					if (sil[j] === 1) {
						if (silLabel[j] < 0) {
							silLabel[j] = seed;
							stack[sp++] = j;
						}
					} else if (cand[j] === 1) {
						candSeeds.add(label[j]);
					} else {
						touchesOpen = true;
					}
				}
			}
			if (!touchesOpen) {
				for (const s of candSeeds) hasIsland.add(s);
			}
		}
		for (const seed of [...okBySeed]) {
			if (!hasIsland.has(seed)) okBySeed.delete(seed);
		}
	}

	if (okBySeed.size === 0) return sil;
	const out = Uint8Array.from(sil);
	for (const seed of okBySeed) {
		const comp = pixelsBySeed.get(seed);
		if (comp) for (const i of comp) out[i] = 1;
	}
	return out;
}

/**
 * Remove da silhueta os componentes cuja TINTA total é desprezível
 * (≤ `maxInk` px²): 1-4 pontos de dither isolados no fundo da foto viram,
 * cada um, uma mini-silhueta com anel — pontinhos pretos "sujeira" soltos no
 * invertido. Um acessório pequeno de verdade (miçanga, ponto de letra) tem
 * dezenas/centenas de px de tinta e passa ileso.
 */
export function dropLowInkComponents(
	sil: Uint8Array,
	ink: Uint8Array,
	W: number,
	H: number,
	maxInk: number,
): Uint8Array {
	const N = W * H;
	const out = Uint8Array.from(sil);
	const label = new Int32Array(N).fill(-1);
	const stack = new Int32Array(N);
	const comp: number[] = [];
	for (let seed = 0; seed < N; seed++) {
		if (sil[seed] !== 1 || label[seed] >= 0) continue;
		let sp = 0;
		let inkCount = 0;
		comp.length = 0;
		stack[sp++] = seed;
		label[seed] = seed;
		while (sp > 0) {
			const i = stack[--sp];
			// Guarda os pixels só enquanto o componente ainda é "descartável" —
			// passou de maxInk, é conteúdo de verdade e não precisamos da lista.
			if (inkCount <= maxInk) comp.push(i);
			if (ink[i] === 1) inkCount++;
			const x = i % W;
			const y = (i / W) | 0;
			const nb = [
				x > 0 ? i - 1 : -1,
				x < W - 1 ? i + 1 : -1,
				y > 0 ? i - W : -1,
				y < H - 1 ? i + W : -1,
			];
			for (const j of nb) {
				if (j >= 0 && sil[j] === 1 && label[j] < 0) {
					label[j] = seed;
					stack[sp++] = j;
				}
			}
		}
		if (inkCount <= maxInk) for (const i of comp) out[i] = 0;
	}
	return out;
}

export interface CarveOptions {
	/** Distância (px) da tinta que ainda conta como "área desenhada". */
	halo: number;
	/** Área mínima (px²) de papel vazio que vale a pena escavar. */
	minArea: number;
}

/**
 * ESCAVA da silhueta o PAPEL VAZIO: regiões dentro de `sil` mais distantes
 * que `halo` de qualquer tinta e maiores que `minArea`. É a regra que separa
 * "vão de hachura/mecha" (célula minúscula entre traços — INVERTE, é o que
 * preserva o detalhe do desenho) de "janela de fundo" (papel branco visto
 * através da figura, ex.: o vão entre o antebraço levantado e o rosto — o
 * fillHoles preenchia esses buracos fechados e o negativo pintava de preto
 * o que o usuário lê como fundo). Medido num desenho a lápis real: janelas
 * de 0,3-1,3% da tela contra vãos de hachura ≤0,02% — órdens de magnitude
 * de folga.
 *
 * A borda da escavação fica na banda `dilate(tinta, halo)` — os traços que
 * delimitam a janela ganham um rebordo fino de campo, o contorno interno.
 *
 * Células majoritariamente dentro de `sil ∧ ¬silBefore` (área ADICIONADA
 * pela absorção de bolsões) são poupadas: a absorção já provou que ali é
 * interior do assunto com desenho esparso (ex.: peito de camisa com logos)
 * — escavar de volta desfaria a decisão.
 */
export function carveEmptyPaper(
	sil: Uint8Array,
	silBefore: Uint8Array,
	ink: Uint8Array,
	W: number,
	H: number,
	opts: CarveOptions,
): Uint8Array {
	const N = W * H;
	// Halo suavizado: a dilatação por quadrado deixa o rebordo da escavação
	// com cantos retos/degraus ("retângulos" no meio do desenho) — o filtro
	// de maioria arredonda o halo antes de recortar as células.
	const occ = smoothMask(
		dilateSquare(ink, W, H, opts.halo),
		W,
		H,
		Math.max(2, opts.halo >> 1),
	);
	const empty = new Uint8Array(N);
	let any = 0;
	for (let i = 0; i < N; i++) {
		if (sil[i] === 1 && occ[i] !== 1) {
			empty[i] = 1;
			any++;
		}
	}
	if (any === 0) return sil;

	const out = Uint8Array.from(sil);
	const label = new Int32Array(N).fill(-1);
	const stack = new Int32Array(N);
	for (let seed = 0; seed < N; seed++) {
		if (empty[seed] !== 1 || label[seed] >= 0) continue;
		let sp = 0;
		let size = 0;
		let absorbed = 0;
		const comp: number[] = [];
		stack[sp++] = seed;
		label[seed] = seed;
		while (sp > 0) {
			const i = stack[--sp];
			size++;
			comp.push(i);
			if (silBefore[i] === 0) absorbed++;
			const x = i % W;
			const y = (i / W) | 0;
			const nb = [
				x > 0 ? i - 1 : -1,
				x < W - 1 ? i + 1 : -1,
				y > 0 ? i - W : -1,
				y < H - 1 ? i + W : -1,
			];
			for (const j of nb) {
				if (j >= 0 && empty[j] === 1 && label[j] < 0) {
					label[j] = seed;
					stack[sp++] = j;
				}
			}
		}
		if (size >= opts.minArea && absorbed / size < 0.5) {
			for (const i of comp) out[i] = 0;
		}
	}
	return out;
}

/**
 * Suaviza a máscara com um FILTRO DE MAIORIA em janela (2r+1)²: cada pixel
 * vira o voto majoritário da vizinhança. Arredonda os degraus/chanfros que o
 * kernel QUADRADO do close/dilate deixa em bordas diagonais (métrica
 * Chebyshev) sem mudar a topologia — braços finos da silhueta sobrevivem
 * porque já saem do pipeline com largura ≥ 2·border (> janela/2).
 * Separável e O(N) como a morfologia: soma corrente por linha e por coluna.
 */
export function smoothMask(
	m: Uint8Array,
	W: number,
	H: number,
	r: number,
): Uint8Array {
	if (r <= 0) return Uint8Array.from(m);
	const win = 2 * r + 1;

	// Passada horizontal: contagem na janela da linha.
	const rowCount = new Uint16Array(W * H);
	for (let y = 0; y < H; y++) {
		const row = y * W;
		let count = 0;
		for (let k = 0; k <= Math.min(r, W - 1); k++) count += m[row + k];
		for (let x = 0; x < W; x++) {
			rowCount[row + x] = count;
			const rem = x - r;
			if (rem >= 0) count -= m[row + rem];
			const add = x + 1 + r;
			if (add < W) count += m[row + add];
		}
	}

	// Passada vertical: soma das contagens → total na janela 2D.
	const out = new Uint8Array(W * H);
	const half = (win * win) >> 1;
	for (let x = 0; x < W; x++) {
		let total = 0;
		for (let k = 0; k <= Math.min(r, H - 1); k++) total += rowCount[k * W + x];
		for (let y = 0; y < H; y++) {
			out[y * W + x] = total > half ? 1 : 0;
			const rem = y - r;
			if (rem >= 0) total -= rowCount[rem * W + x];
			const add = y + 1 + r;
			if (add < H) total += rowCount[add * W + x];
		}
	}
	return out;
}

/** Codifica uma máscara binária (1 = frente) num PNG 1-canal (0 = preto, 255 = branco). */
export async function encodeMaskToPng(
	mask: Uint8Array,
	W: number,
	H: number,
): Promise<Buffer> {
	const out = Buffer.allocUnsafe(W * H);
	for (let i = 0; i < W * H; i++) out[i] = mask[i] === 1 ? 0 : 255;
	return sharp(out, { raw: { width: W, height: H, channels: 1 } })
		.png()
		.toBuffer();
}

/**
 * Silhueta como PNG SÓLIDO (preto = dentro da figura), sem vazar a hachura.
 *
 * É a entrada do negativo LOSSLESS: traçamos só este contorno — uma forma lisa,
 * que não precisa de resolução — e a arte original entra como furos, ainda em
 * vetor. Assim a hachura nunca passa por raster.
 */
export async function silhouetteMaskPng(
	svg: string,
	maxDim: number,
	opts: NegativeOptions = {},
): Promise<{ png: Buffer; width: number; height: number }> {
	const { ink, width: W, height: H } = await rasterizeSvgToInkMask(svg, maxDim);
	const sil = computeSilhouetteMask(ink, W, H, opts);
	const png = await encodeMaskToPng(sil, W, H);
	return { png, width: W, height: H };
}

const MODE_DIM = 256;

/** Ver comentário em `chooseInvertMode` — medido contra um retrato em nanquim real. */
const SUBPATH_COMPLEXITY_THRESHOLD = 200;

/**
 * Escolhe o modo de inversão.
 *
 * A fonte de verdade é o TIPO já decidido na geração (`params.subject`), igual
 * à referência, onde é o modo escolhido (laserphoto vs laserpro) que determina
 * negativo morfológico ou complemento geométrico. Gravura de FOTO é hachura:
 * o complemento viraria um retângulo preto quase sólido, então vai de silhueta.
 * Logo/texto/traço vai de geométrico, que é lossless.
 *
 * A heurística de pixels abaixo é só o fallback para vetores antigos, sem o
 * campo gravado — e ela erra: um retrato hachurado com 5,6% de tinta reprovava
 * no `occ > 0.08` e caía em geométrico, entregando exatamente o retângulo.
 */
export function invertModeForSubject(
	subject: unknown,
): 'geometric' | 'silhouette' | null {
	if (subject === 'photo') return 'silhouette';
	if (subject === 'logo') return 'geometric';
	return null;
}

export async function chooseInvertMode(
	svg: string,
): Promise<'geometric' | 'silhouette'> {
	const {
		ink,
		width: W,
		height: H,
	} = await rasterizeSvgToInkMask(svg, MODE_DIM);
	const N = W * H;
	let sum = 0;
	let minX = W;
	let minY = H;
	let maxX = -1;
	let maxY = -1;
	for (let i = 0; i < N; i++) {
		if (!ink[i]) continue;
		sum++;
		const x = i % W;
		const y = (i / W) | 0;
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	}
	const occ = sum / N;
	if (occ === 0) return 'geometric';

	const eroded = erodeSquare(ink, W, H, 2);
	let survived = 0;
	for (let i = 0; i < N; i++) survived += eroded[i];
	const survivalErode2 = survived / sum;

	const bboxCoverage =
		maxX >= minX && maxY >= minY
			? ((maxX - minX + 1) * (maxY - minY + 1)) / N
			: 0;

	// `occ` só precisa descartar imagem quase em branco (o `occ === 0` acima já
	// pega o caso zero) — quem realmente distingue hachura fina (silhueta) de
	// forma sólida de logo (geométrico) é `survivalErode2`: um traço de 1px
	// desaparece por completo numa erosão de 2px (sobra 0%), uma forma chapada
	// sobrevive. Testado: um retrato hachurado com 5,6% de tinta tinha
	// survivalErode2=0 e bboxCoverage>0.5 — só o limiar de 8% (alto demais)
	// barrava. Medido com hachura sintética de 1px em várias densidades.
	const bySparsity = survivalErode2 < 0.25 && occ > 0.02 && bboxCoverage > 0.5;
	if (bySparsity) return 'silhouette';

	// `survivalErode2` só pega TRAÇO FINO (desaparece na erosão). Line-art densa
	// de traço médio/grosso (ex.: ilustração em nanquim com sombreado em blocos,
	// não hachura de 1px) sobrevive à erosão como um logo — mas ainda tem
	// detalhe fino demais pro complemento geométrico ficar legível (cada
	// mecha/textura vira um furo minúsculo próprio). O que separa esse caso de
	// um logo de verdade é a CONTAGEM de subpaths do próprio vetor: um retrato
	// em nanquim medido tinha 1548 subpaths com survivalErode2=0,59 (bem acima
	// do limiar acima) — um logo típico fica na casa de dezenas, não centenas.
	const geo = readSvgGeometry(svg);
	const subpathCount = geo
		? geo.ds.reduce((acc, d) => acc + (d.match(/M/g)?.length ?? 0), 0)
		: 0;
	return subpathCount > SUBPATH_COMPLEXITY_THRESHOLD
		? 'silhouette'
		: 'geometric';
}
