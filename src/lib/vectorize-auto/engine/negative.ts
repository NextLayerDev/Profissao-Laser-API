// Negativo para gravação em copo ESCURO/pintado.
//
// No copo escuro o laser REMOVE a tinta e revela o metal claro — o resultado
// fica invertido. Para acertar, a área gravada (clara) precisa ser o FUNDO da
// figura (uma silhueta sólida com uma pequena borda) e as LINHAS do desenho
// precisam permanecer (não gravar), aparecendo como furos dentro da silhueta.
//
// Pipeline determinística (sem IA), reusando o binarizador do laser + morfologia:
//   1. binariza (Otsu + auto-fundo) → máscara de tinta (as linhas/marca).
//   2. silhueta sólida = close (funde traços) + fill-holes (preenche o miolo).
//   3. borda = dilata a silhueta por N px ("uma borda um pouco maior").
//   4. negativo = (silhueta+borda) E NÃO (tinta)  → preto = gravar.
// O potrace traça o preto → UM compound path: contorno da silhueta + linhas
// como furos (even-odd). Exatamente o negativo do copo escuro.

import fs from 'node:fs/promises';
import sharp from 'sharp';
import { type LaserPreprocessOptions, preprocessLaserToFile } from './laser.js';

function clamp(v: number, lo: number, hi: number) {
	return v < lo ? lo : v > hi ? hi : v;
}

// 3x3 dilate: fg se QUALQUER vizinho for fg. Retorna novo array.
function dilatePass(src: Uint8Array, W: number, H: number): Uint8Array {
	const out = new Uint8Array(W * H);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			let v = 0;
			for (let dy = -1; dy <= 1 && v === 0; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx,
						ny = y + dy;
					if (
						nx >= 0 &&
						ny >= 0 &&
						nx < W &&
						ny < H &&
						src[ny * W + nx] === 1
					) {
						v = 1;
						break;
					}
				}
			}
			out[y * W + x] = v;
		}
	}
	return out;
}

// 3x3 erode: fg só se TODOS os vizinhos forem fg (fora dos limites conta como bg).
function erodePass(src: Uint8Array, W: number, H: number): Uint8Array {
	const out = new Uint8Array(W * H);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			let v = 1;
			for (let dy = -1; dy <= 1 && v === 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx,
						ny = y + dy;
					const fg =
						nx >= 0 && ny >= 0 && nx < W && ny < H && src[ny * W + nx] === 1;
					if (!fg) {
						v = 0;
						break;
					}
				}
			}
			out[y * W + x] = v;
		}
	}
	return out;
}

function dilate(m: Uint8Array, W: number, H: number, r: number): Uint8Array {
	let d = m;
	for (let i = 0; i < r; i++) d = dilatePass(d, W, H);
	return d;
}

// Close = dilate depois erode: funde traços próximos e fecha pequenos vãos do
// contorno sem crescer a forma.
function close(m: Uint8Array, W: number, H: number, r: number): Uint8Array {
	let d = m;
	for (let i = 0; i < r; i++) d = dilatePass(d, W, H);
	for (let i = 0; i < r; i++) d = erodePass(d, W, H);
	return d;
}

// Preenche os buracos internos: inunda o fundo (bg=0) a partir das bordas; todo
// bg não alcançado está cercado por fg → vira fg (miolo da figura).
function fillHoles(fg: Uint8Array, W: number, H: number): Uint8Array {
	const reach = new Uint8Array(W * H);
	const stack: number[] = [];
	const pushIfBg = (i: number) => {
		if (fg[i] === 0 && reach[i] === 0) {
			reach[i] = 1;
			stack.push(i);
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
	while (stack.length) {
		const i = stack.pop()!;
		const x = i % W,
			y = (i / W) | 0;
		if (x > 0) pushIfBg(i - 1);
		if (x < W - 1) pushIfBg(i + 1);
		if (y > 0) pushIfBg(i - W);
		if (y < H - 1) pushIfBg(i + W);
	}
	const out = Uint8Array.from(fg);
	for (let i = 0; i < out.length; i++)
		if (fg[i] === 0 && reach[i] === 0) out[i] = 1;
	return out;
}

// Sela a silhueta contra as bordas da imagem. Quando a figura é CORTADA pelo
// enquadramento (ex.: retrato com corpo/braço saindo pela borda de baixo), o
// contorno não existe na linha do corte e o flood-fill do fillHoles entra
// pelos vãos das hachuras — o miolo não preenche e o fechamento falha embaixo.
// Em duas passadas por borda:
//   1. escora: posição da borda com tinta a até `depth` px → preenche da borda
//      até a tinta (fecha o vão daquela coluna/linha);
//   2. ponte: vãos de até `gap` px entre escoras/tinta na linha da borda são
//      preenchidos (fecha canais estreitos, ex.: entre hachuras verticais).
// Arte com margem real (> depth) em volta não é afetada.
function sealAgainstEdges(
	ink: Uint8Array,
	W: number,
	H: number,
	depth: number,
	gap: number,
): Uint8Array {
	const out = Uint8Array.from(ink);
	// idx(pos, d): pixel na posição `pos` ao longo da borda, a `d` px para dentro.
	const sealEdge = (len: number, idx: (pos: number, d: number) => number) => {
		for (let pos = 0; pos < len; pos++) {
			for (let d = 0; d < depth; d++) {
				if (ink[idx(pos, d)] === 1) {
					for (let dd = 0; dd < d; dd++) out[idx(pos, dd)] = 1;
					break;
				}
			}
		}
		// Ponte na linha da borda: liga escoras/tinta separadas por vãos curtos.
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

export interface NegativeOptions {
	/** Espessura da borda da silhueta em px (default: ~1.8% da menor dimensão). */
	border?: number;
}

// Gera o PNG bilevel do NEGATIVO (preto = gravar) pronto pro traceLaser/potrace.
// Devolve o threshold/inverted do binarizador (diagnóstico), igual ao laser.
export async function preprocessNegativeToFile(
	buffer: Buffer,
	laser: LaserPreprocessOptions,
	opts: NegativeOptions,
	outputPath: string,
): Promise<{ threshold: number; inverted: boolean }> {
	// 1. Binariza (marca preta sobre branco) reusando a pipeline do laser.
	const inkPath = `${outputPath.replace(/\.png$/i, '')}-ink.png`;
	const meta = await preprocessLaserToFile(buffer, laser, inkPath);

	// 2. Máscara de tinta (1 = marca/linha). A marca sai preta → pixel < 128.
	const { data, info } = await sharp(inkPath)
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const W = info.width,
		H = info.height,
		N = W * H,
		ch = info.channels;
	const ink = new Uint8Array(N);
	for (let i = 0; i < N; i++) ink[i] = data[i * ch] < 128 ? 1 : 0;

	// 3. Silhueta sólida + borda. O selo fecha a figura contra as bordas do
	// enquadramento (corte) antes do fill — o negativo final usa a tinta
	// ORIGINAL, então a área selada vira gravação (miolo branco no copo).
	const minDim = Math.min(W, H);
	const closeR = clamp(Math.round(minDim * 0.01), 1, 6);
	const borderR = clamp(opts.border ?? Math.round(minDim * 0.018), 2, 14);
	const sealDepth = clamp(Math.round(minDim * 0.05), 4, 60);
	const sealGap = clamp(Math.round(minDim * 0.04), 4, 48);
	// O selo entra DEPOIS do close (a erosão do close apagaria a linha de 1px
	// encostada na borda) e ANTES do fill, que só acrescenta.
	let sil = close(ink, W, H, closeR);
	sil = sealAgainstEdges(sil, W, H, sealDepth, sealGap);
	sil = fillHoles(sil, W, H);
	sil = dilate(sil, W, H, borderR);

	// 4. Negativo: preto (0) onde está na silhueta+borda e NÃO é linha; branco (255) no resto.
	const out = Buffer.allocUnsafe(N);
	for (let i = 0; i < N; i++) out[i] = sil[i] === 1 && ink[i] === 0 ? 0 : 255;

	await sharp(out, { raw: { width: W, height: H, channels: 1 } })
		.png()
		.toFile(outputPath);
	await fs.unlink(inkPath).catch(() => {});

	return meta;
}
