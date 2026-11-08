/**
 * Quantização de cor por k-means (RGB puro, sem peso de luminância) sobre os
 * pixels opacos de uma imagem RGBA. Fielidade de cor real — não posterize/escala
 * de cinza. Usado pelo StickerAI para vetorizar adesivos coloridos:
 * cada centróide vira um path SVG preenchido com a cor exata da paleta.
 *
 * puro JS, sem dependências externas. Opera sobre o buffer raw do sharp.
 */

export interface PaletteColor {
	r: number;
	g: number;
	b: number;
	hex: string;
	count: number;
}

export interface QuantizeResult {
	palette: PaletteColor[];
	/** labels[j] = índice da cor do pixel linear j (y*width+x), ou -1 se transparente. */
	labels: Int32Array;
	width: number;
	height: number;
}

function toHex(r: number, g: number, b: number): string {
	const h = (n: number) =>
		Math.max(0, Math.min(255, Math.round(n)))
			.toString(16)
			.padStart(2, '0');
	return `#${h(r)}${h(g)}${h(b)}`;
}

function sqDist(
	r1: number,
	g1: number,
	b1: number,
	r2: number,
	g2: number,
	b2: number,
): number {
	const dr = r1 - r2,
		dg = g1 - g2,
		db = b1 - b2;
	return dr * dr + dg * dg + db * db;
}

/**
 * k-means++ sobre os pixels com alpha > alphaThreshold.
 * @param rgba  buffer raw RGBA do sharp (channels=4)
 * @param k     número de cores (4-16, clampado)
 */
export function kmeansQuantize(
	rgba: Uint8Array,
	alphaThreshold: number,
	k: number,
	iterations = 12,
): QuantizeResult {
	// Coleta pixels opacos. Amostra para a inicialização (acelerar k-means++).
	const pixels: number[] = []; // [r,g,b, r,g,b, ...] só opacos
	const opIdx: number[] = []; // índice linear (y*width+x) de cada pixel opaco coletado
	for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
		if (rgba[i + 3] > alphaThreshold) {
			pixels.push(rgba[i], rgba[i + 1], rgba[i + 2]);
			opIdx.push(j);
		}
	}

	const width = 0; // não usado aqui; largura vem de fora
	void width;

	const n = opIdx.length;
	const kk = Math.max(1, Math.min(k, Math.min(16, n)));

	// Caso degenerado: nenhum pixel opaco
	if (n === 0) {
		return { palette: [], labels: new Int32Array(0), width: 0, height: 0 };
	}

	// ─── k-means++ init ───
	const cents: number[] = new Array(kk * 3);
	// primeiro centróide: pixel aleatório determinístico (índice ~n/2 p/ reprodutibilidade sem Math.random)
	const seedFirst = opIdx[Math.floor(n / 2)] >= 0 ? Math.floor(n / 2) : 0;
	cents[0] = pixels[seedFirst * 3];
	cents[1] = pixels[seedFirst * 3 + 1];
	cents[2] = pixels[seedFirst * 3 + 2];

	const dist2 = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		dist2[i] = sqDist(
			pixels[i * 3],
			pixels[i * 3 + 1],
			pixels[i * 3 + 2],
			cents[0],
			cents[1],
			cents[2],
		);
	}

	for (let c = 1; c < kk; c++) {
		let sum = 0;
		for (let i = 0; i < n; i++) sum += dist2[i];
		// seleciona o pixel com a MAIOR distância acumulada (variação determinística
		// do k-means++ sem Math.random: pega o mais distante do centróide mais próximo).
		const target = sum > 0 ? sum * 0.5 : 0;
		let acc = 0;
		let pick = 0;
		for (let i = 0; i < n; i++) {
			acc += dist2[i];
			if (acc >= target) {
				pick = i;
				break;
			}
		}
		cents[c * 3] = pixels[pick * 3];
		cents[c * 3 + 1] = pixels[pick * 3 + 1];
		cents[c * 3 + 2] = pixels[pick * 3 + 2];
		for (let i = 0; i < n; i++) {
			const d = sqDist(
				pixels[i * 3],
				pixels[i * 3 + 1],
				pixels[i * 3 + 2],
				cents[c * 3],
				cents[c * 3 + 1],
				cents[c * 3 + 2],
			);
			if (d < dist2[i]) dist2[i] = d;
		}
	}

	// ─── Lloyd iterations ───
	const assign = new Int32Array(n);
	for (let it = 0; it < iterations; it++) {
		let changed = false;
		for (let i = 0; i < n; i++) {
			let best = 0;
			let bestD = sqDist(
				pixels[i * 3],
				pixels[i * 3 + 1],
				pixels[i * 3 + 2],
				cents[0],
				cents[1],
				cents[2],
			);
			for (let c = 1; c < kk; c++) {
				const d = sqDist(
					pixels[i * 3],
					pixels[i * 3 + 1],
					pixels[i * 3 + 2],
					cents[c * 3],
					cents[c * 3 + 1],
					cents[c * 3 + 2],
				);
				if (d < bestD) {
					bestD = d;
					best = c;
				}
			}
			if (assign[i] !== best) {
				assign[i] = best;
				changed = true;
			}
		}

		// recompute centróides
		const sumR = new Float64Array(kk);
		const sumG = new Float64Array(kk);
		const sumB = new Float64Array(kk);
		const cnt = new Int32Array(kk);
		for (let i = 0; i < n; i++) {
			const c = assign[i];
			sumR[c] += pixels[i * 3];
			sumG[c] += pixels[i * 3 + 1];
			sumB[c] += pixels[i * 3 + 2];
			cnt[c]++;
		}
		for (let c = 0; c < kk; c++) {
			if (cnt[c] > 0) {
				cents[c * 3] = sumR[c] / cnt[c];
				cents[c * 3 + 1] = sumG[c] / cnt[c];
				cents[c * 3 + 2] = sumB[c] / cnt[c];
			}
		}
		if (!changed && it > 1) break;
	}

	// ─── Paleta final (ordenada por frequência desc) ───
	const counts = new Int32Array(kk);
	for (let i = 0; i < n; i++) counts[assign[i]]++;
	const order = Array.from({ length: kk }, (_, c) => c)
		.filter((c) => counts[c] > 0)
		.sort((a, b) => counts[b] - counts[a]);

	const palette: PaletteColor[] = order.map((c) => ({
		r: Math.round(cents[c * 3]),
		g: Math.round(cents[c * 3 + 1]),
		b: Math.round(cents[c * 3 + 2]),
		hex: toHex(cents[c * 3], cents[c * 3 + 1], cents[c * 3 + 2]),
		count: counts[c],
	}));

	// remapeia índices antigos → nova ordem
	const remap = new Int32Array(kk).fill(-1);
	order.forEach((c, i) => {
		remap[c] = i;
	});

	// labels por índice linear do pixel original
	const totalPixels = rgba.length / 4;
	const labels = new Int32Array(totalPixels).fill(-1);
	for (let i = 0; i < n; i++) {
		labels[opIdx[i]] = remap[assign[i]];
	}

	return { palette, labels, width: 0, height: 0 };
}

/**
 * Constrói a máscara 1-canal (grayscale) para uma cor: pixels dessa cor = 0
 * (preto = será traçado pelo potrace com blackOnWhite), demais = 255 (branco).
 * Em RGBA para o sharp gerar PNG grayscale.
 */
export function buildMask(
	labels: Int32Array,
	colorIndex: number,
	width: number,
	height: number,
): Buffer {
	const mask = Buffer.alloc(width * height, 255);
	for (let j = 0; j < labels.length; j++) {
		if (labels[j] === colorIndex) mask[j] = 0;
	}
	return mask;
}

/**
 * Máscara do sujeito (cut path): todo pixel opaco = 0 (preto), transparente = 255.
 */
export function buildAlphaMask(
	rgba: Uint8Array,
	alphaThreshold: number,
	width: number,
	height: number,
): Buffer {
	const mask = Buffer.alloc(width * height, 255);
	for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
		if (rgba[i + 3] > alphaThreshold) mask[j] = 0;
	}
	return mask;
}
