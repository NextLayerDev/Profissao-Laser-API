import sharp from 'sharp';
import { readSvgGeometry } from './svg-invert.js';
import { computeSilhouetteMask } from './svg-negative.js';
import { rasterizeSvgToInkMask, rasterizeSvgToPng } from './svg-raster.js';

// ─────────────────────────────────────────────────────────────────────
// NEGATIVO LOCAL — inverte os tons só DENTRO da silhueta do assunto; fora
// dela (o fundo de verdade) fica como está. É o modo `silhouette` do
// Inverter pra gravura de foto/hachura: preserva TODO o detalhe interno do
// desenho original (diferente de uma silhueta sólida chapada, que perde o
// desenho) mas sem herdar o fundo inteiro pintado de preto do
// `rasterNegative` puro (que faz a imagem inteira, fundo incluso, ficar
// "pesada" — o problema original reportado).
//
// Reaproveita a mesma reconstrução morfológica de `svg-negative.ts`
// (fecha → sela → preenche → dilata) que já foi tentada e abandonada para
// DUAS ideias diferentes: (1) compound path com a arte original como furos,
// even-odd, vetorial; (2) contorno traçado e preenchido chapado, sem
// detalhe. Aqui não traça nada — a máscara de silhueta vira só o CRITÉRIO de
// "que pixel inverter", a inversão em si é raster puro (igual
// `rasterNegative`), só que restrita à área da silhueta.
//
// A morfologia é conhecida por vazar em formas finas/diagonais — aqui um
// pedaço que não funde à silhueta não "vaza pra fora do contorno" (não tem
// contorno vetorial nenhum): ele só fica com a polaridade ERRADA (não
// invertido), um remendo visível. `closeR` maior que o default de
// `computeSilhouetteMask` (medido: 1,5× já resolve pulseira/franja soltas
// perto do corpo) reduz isso; o detector de componentes conectados abaixo
// pega o que sobrar e cai pro `rasterNegative` de sempre.
// ─────────────────────────────────────────────────────────────────────

export interface SilhouetteContourOptions {
	/** Lado maior do raster de trabalho. */
	maxDim?: number;
}

export type SilhouetteContourFailReason = 'no_geometry' | 'empty' | 'fragmented';

export type SilhouetteContourResult =
	| { ok: true; svg: string }
	| { ok: false; reason: SilhouetteContourFailReason };

interface Attempt {
	maxDim: number;
	closeRMultiplier: number;
}

/**
 * Uma retentativa só. `closeRMultiplier` de 1,5 no default de
 * `computeSilhouetteMask` (~1% da menor dimensão) é o valor medido contra um
 * caso real (retrato com pulseira/franja de miçangas soltas perto do
 * pulso) — 1,0× (o default puro) deixava esses pequenos acessórios
 * desconectados da silhueta principal, com a polaridade errada. A
 * retentativa dobra pra casos piores.
 */
const ATTEMPTS: Attempt[] = [
	{ maxDim: 1600, closeRMultiplier: 1.5 },
	{ maxDim: 2000, closeRMultiplier: 3 },
];

/**
 * Fração da área total abaixo da qual um componente conectado da silhueta
 * conta como ruído (não "um pedaço relevante que não fundiu"). Acima disso
 * e fora do maior componente é sinal de fragmentação de verdade.
 */
const SIGNIFICANT_COMPONENT_AREA_FRACTION = 0.002;

/** Conta componentes 4-conectados de `mask` com área ≥ `minAreaFraction` da tela. */
function countSignificantComponents(
	mask: Uint8Array,
	W: number,
	H: number,
	minAreaFraction: number,
): number {
	const N = W * H;
	const label = new Int32Array(N).fill(-1);
	const stack = new Int32Array(N);
	const sizes: number[] = [];
	for (let seed = 0; seed < N; seed++) {
		if (mask[seed] !== 1 || label[seed] >= 0) continue;
		let sp = 0;
		let count = 0;
		stack[sp++] = seed;
		label[seed] = seed;
		while (sp > 0) {
			const i = stack[--sp];
			count++;
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
		sizes.push(count);
	}
	const minArea = Math.max(1, Math.round(N * minAreaFraction));
	return sizes.filter((s) => s >= minArea).length;
}

/** Negativo de pixel (255-v) restrito aos pixels onde `sil` é foreground. */
async function negateWithinMask(
	originalSvg: string,
	sil: Uint8Array,
	W: number,
	H: number,
): Promise<Buffer> {
	const originalPng = await rasterizeSvgToPng(originalSvg, {
		maxDim: Math.max(W, H),
		flattenWhite: true,
	});
	const { data, info } = await sharp(originalPng)
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	// `rasterizeSvgToPng` já usa o mesmo `maxDim`/aspecto da rasterização que
	// gerou `sil` — dimensão bate por construção, sem precisar realinhar.
	const out = Buffer.allocUnsafe(info.width * info.height);
	for (let i = 0; i < out.length; i++) {
		out[i] = sil[i] === 1 ? 255 - data[i] : data[i];
	}
	return sharp(out, {
		raw: { width: info.width, height: info.height, channels: info.channels },
	})
		.png()
		.toBuffer();
}

/**
 * Constrói o negativo local do SVG — inverte os tons só dentro da silhueta
 * do assunto, preservando o desenho original e o fundo verdadeiro. Ver
 * comentário de topo do arquivo.
 */
export async function buildSilhouetteContourSvg(
	originalSvg: string,
	opts: SilhouetteContourOptions = {},
): Promise<SilhouetteContourResult> {
	const geo = readSvgGeometry(originalSvg);
	if (!geo) return { ok: false, reason: 'no_geometry' };

	let lastFragmented = false;

	for (const attempt of ATTEMPTS) {
		const maxDim = opts.maxDim ?? attempt.maxDim;
		const {
			ink,
			width: W,
			height: H,
		} = await rasterizeSvgToInkMask(originalSvg, maxDim);

		let inkCount = 0;
		for (let i = 0; i < ink.length; i++) inkCount += ink[i];
		if (inkCount === 0) return { ok: false, reason: 'empty' };

		const minDim = Math.min(W, H);
		const closeR = Math.max(1, Math.round(minDim * 0.01 * attempt.closeRMultiplier));
		const sil = computeSilhouetteMask(ink, W, H, { closeR });

		const components = countSignificantComponents(
			sil,
			W,
			H,
			SIGNIFICANT_COMPONENT_AREA_FRACTION,
		);
		if (components > 1) {
			lastFragmented = true;
			continue;
		}

		const negatedPng = await negateWithinMask(originalSvg, sil, W, H);
		const b64 = negatedPng.toString('base64');
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${geo.w}" height="${geo.h}" viewBox="${geo.x} ${geo.y} ${geo.w} ${geo.h}"><image x="${geo.x}" y="${geo.y}" width="${geo.w}" height="${geo.h}" preserveAspectRatio="none" href="data:image/png;base64,${b64}"/></svg>`;
		return { ok: true, svg };
	}

	return { ok: false, reason: lastFragmented ? 'fragmented' : 'empty' };
}
