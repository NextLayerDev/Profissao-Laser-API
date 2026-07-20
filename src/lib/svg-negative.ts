import sharp from 'sharp';
import { rasterizeSvgToInkMask } from './svg-raster.js';

// ─────────────────────────────────────────────────────────────────────
// NEGATIVO MORFOLÓGICO — o caminho de FOTO/gravura da inversão.
//
// Numa gravura hachurada, o complemento geométrico não serve: a arte é traço
// fino, e o complemento vira uma chapa quase toda preta. O que se quer é o
// negativo de gravação (copo escuro/anodizado, onde o laser REMOVE o
// revestimento): a SILHUETA sólida do assunto vira a área gravada, e as LINHAS
// do desenho permanecem, aparecendo como furos dentro da silhueta.
//
//   1. máscara de tinta (a partir do SVG já aprovado, não da foto original)
//   2. silhueta sólida = close (funde traços) + fill-holes (preenche o miolo)
//   3. borda = dilata a silhueta
//   4. negativo = (silhueta+borda) E NÃO (tinta) → preto = gravar
//
// O Potrace traça o preto → UM compound path: contorno da silhueta + linhas
// como furos (even-odd).
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
	const minDim = Math.min(W, H);
	const closeR = clamp(Math.round(minDim * 0.01), 1, 6);
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

	const out = Buffer.allocUnsafe(W * H);
	for (let i = 0; i < W * H; i++) out[i] = sil[i] === 1 ? 0 : 255;
	const png = await sharp(out, { raw: { width: W, height: H, channels: 1 } })
		.png()
		.toBuffer();
	return { png, width: W, height: H };
}

const MODE_DIM = 256;

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

	return survivalErode2 < 0.25 && occ > 0.08 && bboxCoverage > 0.5
		? 'silhouette'
		: 'geometric';
}
