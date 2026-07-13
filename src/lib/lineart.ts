import sharp from 'sharp';

// ─────────────────────────────────────────────────────────────────────
// LINE-ART sem IA (XDoG — eXtended Difference of Gaussians). Converte uma FOTO
// (ou imagem complexa) em TRAÇOS limpos pretos sobre branco, prontos p/ o Potrace
// vetorizar e p/ gravação a laser — em vez do posterize (manchas de cinza) que
// saía mal. Puro CV via sharp: duas gaussianas → DoG realçada → corte → linhas.
// (O "nanquim" perfeito do produto irmão é feito por IA; isto é o melhor sem IA.)
// ─────────────────────────────────────────────────────────────────────

export interface LineArtOptions {
	/** σ da gaussiana estreita (detalhe fino). Menor = traços mais finos. */
	sigma?: number;
	/** σ da gaussiana larga (vizinhança). A diferença das duas = sinal de borda. */
	sigmaWide?: number;
	/** Corte da magnitude da DoG (0–255). Menor = mais traço/detalhe; maior = só bordas fortes. */
	threshold?: number;
	/** Engrossa/conecta os traços (dilata o preto 1px). Deixa o contorno mais sólido. */
	thicken?: boolean;
}

/**
 * Line-art por DoG (Difference of Gaussians) sobre um buffer JÁ em cinza (1 canal,
 * raw). O sinal `G_estreita − G_larga` é ~0 em áreas chapadas (de QUALQUER brilho)
 * e só dispara nas BORDAS → limiar por magnitude devolve TRAÇOS pretos sobre
 * branco (não enche as sombras como um threshold comum). Molde do loop raw-pixel
 * é o do dithering.
 */
export async function lineArtRaster(
	gray: Buffer,
	width: number,
	height: number,
	opts: LineArtOptions = {},
): Promise<Buffer> {
	const sigma = opts.sigma ?? 0.6;
	const sigmaWide = opts.sigmaWide ?? 2.2;
	const thr = opts.threshold ?? 6;

	const raw = { width, height, channels: 1 as const };

	// Despeckle ANTES da DoG: a diferença de gaussianas amplifica ruído/JPEG e vira
	// chuvisco de traços. A mediana 3×3 mata o ruído preservando as bordas reais.
	// IMPORTANTE: `.median()` promove 1ch→3ch; forçamos `b-w` de volta (senão o raw
	// vem 3× o tamanho e desalinha em faixas horizontais).
	const base = await sharp(gray, { raw })
		.median(3)
		.toColourspace('b-w')
		.raw()
		.toBuffer();

	// Duas gaussianas do MESMO cinza despeckelado (estreita e larga). `b-w` garante 1ch.
	const [g1, g2] = await Promise.all([
		sharp(base, { raw }).blur(sigma).toColourspace('b-w').raw().toBuffer(),
		sharp(base, { raw }).blur(sigmaWide).toColourspace('b-w').raw().toBuffer(),
	]);

	const n = width * height;
	const out = Buffer.alloc(n, 255); // fundo BRANCO
	for (let i = 0; i < n; i++) {
		// DoG: ~0 em área chapada (independe do brilho), grande nas bordas.
		if (Math.abs(g1[i] - g2[i]) > thr) out[i] = 0; // borda → traço PRETO
	}

	if (opts.thicken) {
		// Dilata o preto ~1px (blur espalha, threshold alto re-binariza) → traços
		// mais sólidos e contornos quebrados se reconectam. `b-w` mantém 1ch.
		const grown = await sharp(out, { raw })
			.blur(1)
			.toColourspace('b-w')
			.raw()
			.toBuffer();
		return sharp(grown, { raw }).threshold(210).png().toBuffer();
	}
	return sharp(out, { raw }).png().toBuffer();
}
