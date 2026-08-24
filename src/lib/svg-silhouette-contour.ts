import sharp from 'sharp';
import type { VectorizeParams } from '../types/vector.js';
import { applyDithering } from './dithering.js';
import { readSvgGeometry } from './svg-invert.js';
import {
	absorbEnclosedPockets,
	type BboxSealResult,
	carveEmptyPaper,
	computeSilhouetteMask,
	dropLowInkComponents,
	erodeSquare,
	sealAgainstBboxEdges,
	smoothMask,
} from './svg-negative.js';
import {
	outlineMarginPx,
	scaleAbsolutePathD,
	speckMaxAreaPx,
	traceMaskToPathD,
} from './svg-outline-trace.js';
import { rasterizeSvgToInkMask, rasterizeSvgToPng } from './svg-raster.js';

// ─────────────────────────────────────────────────────────────────────
// NEGATIVO LOCAL — inverte os tons só DENTRO da silhueta do assunto; fora
// dela (o fundo de verdade) fica como está. É o modo `silhouette` do
// Inverter pra gravura de foto/hachura: preserva TODO o detalhe interno do
// desenho original (diferente de uma silhueta sólida chapada, que perde o
// desenho) mas sem herdar o fundo inteiro pintado de preto de um raster
// negate puro (que faz a imagem inteira, fundo incluso, ficar "pesada" —
// o problema original reportado).
//
// A borda VISÍVEL do negativo é o anel baked no raster: a borda dilatada da
// silhueta (espessura FINA compartilhada de `svg-outline-trace.ts` —
// requisito: contorno bem fino, nunca retângulo), suavizada por filtro de
// maioria pra tirar os degraus do kernel quadrado da morfologia. A MESMA
// silhueta é traçada com o Potrace e entra como <path> INVISÍVEL (ver
// `traceContourPath`) — só geometria, pro DXF de foto invertida não sair
// vazio e pro LightBurn ter o shape de corte.
//
// Silhueta com múltiplos pedaços (colar, franja, dois assuntos) é aceita:
// `computeSilhouetteMask`/`negateWithinMask` sempre trataram todos os
// componentes — a recusa por fragmentação que existia aqui era um veto
// posterior cujo único efeito era cair num raster negate de imagem inteira
// (o retângulo preto de novo). Requisito atual: NUNCA retângulo.
// ─────────────────────────────────────────────────────────────────────

export interface SilhouetteContourOptions {
	/** Lado maior do raster de trabalho. */
	maxDim?: number;
	/**
	 * FOTO ORIGINAL do vetor + params da geração. Quando presentes, o
	 * negativo é RE-DITHERIZADO a partir dos tons da foto (fluxo manual dos
	 * artesãos: cinza → inverter TONS → contraste → dither), em vez de
	 * inverter os pixels do bitmap já binarizado — que degrada a estrutura do
	 * dithering e sai "sujo". O motor (`preprocessImage`) já aplica o negate
	 * ANTES do limiar/dither; basta re-rodar com `invert` trocado.
	 */
	originalImage?: Buffer;
	params?: VectorizeParams;
}

export type SilhouetteContourFailReason = 'no_geometry' | 'empty';

export type SilhouetteContourResult =
	| { ok: true; svg: string }
	| { ok: false; reason: SilhouetteContourFailReason };

const WORK_DIM = 1600;

/**
 * `closeR` de 1,5× o default de `computeSilhouetteMask` (~1% da menor
 * dimensão) é o valor medido contra um caso real (retrato com
 * pulseira/franja de miçangas soltas perto do pulso) — 1,0× deixava esses
 * acessórios desconectados da silhueta principal. Hoje um pedaço solto
 * apenas vira um componente próprio (invertido do mesmo jeito), mas fundir
 * o que está perto continua dando um contorno mais limpo.
 */
const CLOSE_R_MULTIPLIER = 1.5;

/**
 * FOTO SANGRADA (full-bleed): a foto ocupa o quadro inteiro e "silhueta do
 * assunto" deixa de existir — o negativo certo é o da foto INTEIRA (o
 * "Negative Image" do LightBurn). A alternativa (excluir os bolsões claros
 * que encostam na borda da foto) deixa buracos brancos ARBITRÁRIOS com
 * borda serrilhada no meio da foto invertida (medido num retrato full-bleed
 * com céu claro no topo).
 *
 * Detecção pelo bbox da TINTA (a borda da imagem não serve: o padForTrace
 * põe margem branca em todo vetor): o bbox cobre quase o quadro todo E a
 * silhueta absorvida preenche quase todo o bbox. Medido: retrato sangrado
 * 96% (dispara), banners sangrados 92-93% (disparam), desenho a lápis 63%
 * (protegido) e arte 360° de caneca 86,7% — o bbox estica até as marcas de
 * junção nas pontas, mas o conteúdo NÃO é sangrado; o corte em 0,9 é o que
 * a separa dos banners de verdade.
 */
const FULL_BLEED_BBOX_FRACTION = 0.9;
const FULL_BLEED_SIL_DENSITY = 0.8;

/**
 * Negativo RE-DITHERIZADO a partir da FOTO ORIGINAL, seguindo a receita do
 * fluxo manual de fotogravação para material escuro (LightBurn/Glowforge/
 * Imag-R/OMTech — pesquisa consolidada):
 *
 *   A) preparação em cinza: stretch de níveis (clip 0,5% por ponta) →
 *      S-curve de contraste → unsharp no tamanho final;
 *   B) INVERTER O CINZA (nunca o bitmap 1-bit: inverter o dither pronto
 *      vira "campo sólido com furos de 1px" que fecham no dot-gain da
 *      queima — a causa do resultado "sujo");
 *   C) reajuste tonal DO NEGATIVO: gamma lift dos meios-tons (dot gain é
 *      unidirecional) + teto de cobertura ~88% (highlight do rosto nunca
 *      vira chapado) + sombras profundas → branco puro (não grava: em
 *      material escuro, sombra = material intocado);
 *   D) UMA única passada de dither, já na resolução final do grid.
 *
 * O tonal roda fora do motor de propósito: o `normalize()` do
 * `preprocessImage` re-esticaria o histograma e desfaria o teto de
 * cobertura da etapa C. O alinhamento com o vetor armazenado é reproduzido
 * pela mesma aritmética de upscale/pad da geração e VERIFICADO contra o
 * viewBox — divergiu, devolve null e o chamador cai no pixel-flip.
 */
const NEG_STRETCH_CLIP = 0.005; // clip 0,5% por ponta (levels)
const NEG_SCURVE_A = 1.9; // tanh: contraste global (2,2 esmagava o toe)
const NEG_GAMMA = 0.8; // lift de meios-tons do negativo (0,70-0,85)
const NEG_COVERAGE_FLOOR = 0.12; // teto de cobertura ≈ 88%
/**
 * PISO DE SOMBRA (regra do "cabelo nunca vira branco puro" dos guias):
 * depois do stretch, nenhum tom entra na curva abaixo disto. Sem o piso, a
 * sombra dura de uma selfie (lado do nariz/olhos) estoura pra branco no
 * negativo e o detalhe é "comido" — com ele, toda sombra guarda uma textura
 * mínima de pontos que preserva o modelado.
 */
const NEG_SHADOW_FLOOR = 0.06;
/**
 * Teto de branco simétrico ao teto de cobertura: nenhum tom sai com menos
 * de ~5% de pontos. É o que garante textura na sombra mais dura (a ilha
 * branca do lado do nariz numa selfie com flash) em vez de papel liso.
 */
const NEG_WHITE_CAP = 0.94;
/**
 * Contraste LOCAL (o "CLAHE-lite" da etapa A8): v' = v + k·(v − blur_grande).
 * Sem ele, sombra dura de foto (nariz/bochecha em flash) e highlight de
 * roupa CLIPAM em zonas chapadas com fronteira dura — as "quebras" no rosto
 * e na camisa. O contraste local reinjeta gradiente dentro dessas zonas.
 */
const NEG_CLARITY = 0.4;

// ── BLINDAGEM (garantias de que uma "quebra" não sai do pipeline) ──
/** Nenhum degrau tonal na LUT pode exceder isto (continuidade garantida). */
const NEG_LUT_MAX_STEP = 32;
/** Fidelidade do dither: janela 8×8 entre alvo e trama. */
const NEG_FIDELITY_WINDOW = 8;
const NEG_FIDELITY_MEAN_MAX = 16; // erro médio |alvo−trama| permitido
const NEG_FIDELITY_BAD_FRACTION = 0.02; // fração de janelas com erro >40

async function reditheredNegative(
	opts: SilhouetteContourOptions,
	geo: { w: number; h: number },
	W: number,
	H: number,
): Promise<{ neg: Buffer; grayGrid: Buffer } | null> {
	const { originalImage, params } = opts;
	if (!originalImage || !params) return null;
	if (params.mode !== 'trace') return null; // posterize/cores → pixel-flip
	try {
		// ARTE vs FOTO: a receita tonal é para FOTO (tons contínuos). Arte —
		// line-art, logo, desenho a lápis — vive nos extremos do histograma e
		// o pixel-flip do vetor preserva o traço do artista (re-ditherizar
		// substituiria a hachura feita à mão por trama de máquina, e campos
		// sólidos virariam trama de 88%). Probe com kernel NEAREST (um resize
		// normal embaça hachura fina em meios-tons e mascararia a medida).
		// Medido nos casos reais: artes 54-87% de extremos, fotos 4-24% — o
		// corte em 40% separa com folga dos dois lados.
		const probe = await sharp(originalImage, { failOn: 'none' })
			.flatten({ background: '#ffffff' })
			.grayscale()
			.resize(512, 512, { fit: 'inside', kernel: 'nearest' })
			.raw()
			.toBuffer({ resolveWithObject: true });
		let extreme = 0;
		for (let i = 0; i < probe.data.length; i++) {
			const v = probe.data[i];
			if (v <= 30 || v >= 225) extreme++;
		}
		if (extreme / probe.data.length >= 0.4) return null;
		// SEM .rotate(): o pipeline de geração não auto-rotaciona por EXIF —
		// rotacionar aqui desalinharia as dimensões com o vetor armazenado.
		const meta = await sharp(originalImage, { failOn: 'none' }).metadata();
		const w0 = meta.width ?? 0;
		const h0 = meta.height ?? 0;
		if (!w0 || !h0) return null;

		// Reproduz upscale/pad da geração (vectorizeImage) pra achar onde o
		// conteúdo da foto vive dentro do viewBox do vetor armazenado.
		const hasPhysicalSize =
			params.dpi !== null ||
			params.outputWidth !== null ||
			params.outputHeight !== null;
		const maxDim0 = Math.max(w0, h0);
		const scale =
			!hasPhysicalSize && maxDim0 < 1400 ? Math.min(3, 1400 / maxDim0) : 1;
		const w1 = scale > 1 ? Math.round(w0 * scale) : w0;
		const h1 = scale > 1 ? Math.round(h0 * (w1 / w0)) : h0;
		const pad = hasPhysicalSize
			? 0
			: Math.max(6, Math.round(Math.max(w1, h1) * 0.01));
		if (
			Math.abs(w1 + 2 * pad - geo.w) > 2 ||
			Math.abs(h1 + 2 * pad - geo.h) > 2
		) {
			return null; // aritmética não bate com o vetor armazenado
		}

		// Região do conteúdo no grid W×H da silhueta.
		const kx = W / geo.w;
		const ky = H / geo.h;
		const offX = Math.round(pad * kx);
		const offY = Math.round(pad * ky);
		const cw = Math.max(1, Math.round((geo.w - 2 * pad) * kx));
		const ch = Math.max(1, Math.round((geo.h - 2 * pad) * ky));

		// A) cinza no tamanho final + unsharp (mais forte que pra impressão).
		const { data: grayRaw } = await sharp(originalImage, { failOn: 'none' })
			.flatten({ background: '#ffffff' })
			.grayscale()
			.resize(cw, ch, { fit: 'fill' })
			.sharpen({ sigma: 1, m1: 1, m2: 2 })
			.raw()
			.toBuffer({ resolveWithObject: true });

		// A8) Contraste LOCAL (CLAHE-lite): reinjeta gradiente dentro de
		// sombras/highlights duros pra não clipar em zonas chapadas (as
		// "quebras" no rosto/camisa).
		const claritySigma = Math.max(6, Math.round(Math.min(cw, ch) * 0.02));
		const blurred = await sharp(grayRaw, {
			raw: { width: cw, height: ch, channels: 1 },
		})
			.blur(claritySigma)
			.raw()
			.toBuffer();
		const gray = Buffer.allocUnsafe(cw * ch);
		for (let i = 0; i < gray.length; i++) {
			const v = grayRaw[i] + NEG_CLARITY * (grayRaw[i] - blurred[i]);
			gray[i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
		}

		// Histograma → stretch com clip de 0,5% por ponta.
		const hist = new Uint32Array(256);
		for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
		const total = gray.length;
		const clip = Math.max(1, Math.round(total * NEG_STRETCH_CLIP));
		let lo = 0;
		let acc = 0;
		while (lo < 255 && acc + hist[lo] < clip) acc += hist[lo++];
		let hi = 255;
		acc = 0;
		while (hi > lo && acc + hist[hi] < clip) acc += hist[hi--];
		const range = Math.max(1, hi - lo);

		// LUT: stretch → S-curve → invert → gamma → teto de cobertura.
		// SEM snap de branco: qualquer salto na curva vira uma fronteira dura
		// visível no dither (a "quebra") — a curva tem que ser contínua; o
		// fundo é papel do MASK, não da LUT.
		const lut = new Uint8Array(256);
		const tanhHalf = Math.tanh(NEG_SCURVE_A * 0.5);
		for (let v = 0; v < 256; v++) {
			let x = Math.min(1, Math.max(0, (v - lo) / range));
			x = NEG_SHADOW_FLOOR + x * (1 - NEG_SHADOW_FLOOR); // piso de sombra
			const s = 0.5 + Math.tanh(NEG_SCURVE_A * (x - 0.5)) / (2 * tanhHalf);
			let n = (1 - s) ** NEG_GAMMA;
			n *= NEG_WHITE_CAP; // teto de branco: sombra sempre com textura
			n = NEG_COVERAGE_FLOOR + n * (1 - NEG_COVERAGE_FLOOR);
			lut[v] = Math.round(n * 255);
		}
		// BLINDAGEM 1: continuidade tonal garantida — um degrau maior que o
		// permitido na LUT é bug de receita, não sai do pipeline.
		for (let v = 1; v < 256; v++) {
			if (Math.abs(lut[v] - lut[v - 1]) > NEG_LUT_MAX_STEP) {
				console.error(
					`[silhouette-contour] LUT com degrau tonal (${v}) — fallback`,
				);
				return null;
			}
		}
		// Perturbação mínima determinística (LCG ±3): quebra os ciclos-limite
		// da difusão de erro que viram listras/xadrez em áreas chapadas de
		// meio-tom (medido: régua horizontal na jaqueta) sem alterar o tom.
		const mapped = Buffer.allocUnsafe(cw * ch);
		let seed = 0x9e3779b9;
		for (let i = 0; i < mapped.length; i++) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			const jitter = (seed % 11) - 5;
			const v = lut[gray[i]] + jitter;
			mapped[i] = v < 0 ? 0 : v > 255 ? 255 : v;
		}

		// D) uma única passada de dither, na resolução final. JARVIS fixo para
		// o negativo (receita canônica p/ material escuro): o Atkinson
		// descarta 25% do erro — em cobertura esparsa (sombras do negativo)
		// ele APAGA os pontos e cria worms/listras horizontais nos claros
		// (medido: jaqueta com streaks, sombra do nariz sem textura).
		const bin = applyDithering(mapped, cw, ch, 'jarvis', 128);

		// BLINDAGEM 2: fidelidade da trama — a densidade local do dither tem
		// que seguir o tom alvo. Comparação CORRIGIDA PELO VIÉS GLOBAL: o
		// Atkinson descarta 25% do erro por design (clareia de propósito), o
		// que desloca a média uniformemente — defeito de verdade é DESVIO
		// REGIONAL (quebra/faixa), não o viés uniforme. Se divergir
		// regionalmente, não entrega: cai no pixel-flip.
		{
			const win = NEG_FIDELITY_WINDOW;
			const deltas: number[] = [];
			let deltaSum = 0;
			for (let by = 0; by + win <= ch; by += win) {
				for (let bx = 0; bx + win <= cw; bx += win) {
					let tSum = 0;
					let dSum = 0;
					for (let y = 0; y < win; y++) {
						const row = (by + y) * cw + bx;
						for (let x = 0; x < win; x++) {
							tSum += mapped[row + x];
							dSum += bin[row + x];
						}
					}
					const d = (dSum - tSum) / (win * win);
					deltas.push(d);
					deltaSum += d;
				}
			}
			if (deltas.length > 0) {
				const bias = deltaSum / deltas.length;
				let sumErr = 0;
				let bad = 0;
				for (const d of deltas) {
					const err = Math.abs(d - bias);
					sumErr += err;
					if (err > 40) bad++;
				}
				if (
					sumErr / deltas.length > NEG_FIDELITY_MEAN_MAX ||
					bad / deltas.length > NEG_FIDELITY_BAD_FRACTION
				) {
					console.error(
						`[silhouette-contour] trama infiel ao tom (err=${Math.round(sumErr / deltas.length)}, bad=${Math.round((bad / deltas.length) * 1000) / 10}%) — fallback`,
					);
					return null;
				}
			}
		}

		// Cola no canvas branco do grid (a moldura do pad fica branca).
		// O cinza pro FLOOD DE FUNDO é o pós-clarity SEM suavizar: testamos a
		// variante borrada (pra atravessar a penumbra de sombras de parede) e
		// ela VAZA pelos contatos pele-estourada↔parede e come o assunto —
		// borda afiada é o que protege o sujeito. Sombra de fundo com borda
		// definida colada no ombro fica além do alcance do flood tonal (é o
		// caso da remoção de fundo por segmentação/manual).
		const canvas = Buffer.alloc(W * H, 255);
		const grayGrid = Buffer.alloc(W * H, 255);
		for (let y = 0; y < ch; y++) {
			const gy = y + offY;
			if (gy < 0 || gy >= H) continue;
			const len = Math.min(cw, W - offX);
			bin.copy(canvas, gy * W + offX, y * cw, y * cw + len);
			gray.copy(grayGrid, gy * W + offX, y * cw, y * cw + len);
		}
		return { neg: canvas, grayGrid };
	} catch (err) {
		console.error('[silhouette-contour] negativo re-ditherizado falhou:', err);
		return null;
	}
}

/**
 * FUNDO da foto por crescimento tonal: semeia nas arestas do bbox onde o
 * assunto NÃO é cortado (arestas de fundo) e cresce por vizinhos de tom
 * quase igual (passo ≤ `stepTol`), parando nas bordas do assunto (salto de
 * tom). Pega o fundo liso INCLUSIVE gradientes (a sombra da parede colada
 * no ombro — que a silhueta de tinta engolia e virava mancha escura no
 * negativo). É o análogo determinístico do "remoção de fundo" do fluxo
 * manual — sem IA, sem custo.
 */
function photoBackgroundMask(
	grayGrid: Buffer,
	W: number,
	H: number,
	seal: BboxSealResult,
): Uint8Array {
	const bg = new Uint8Array(W * H);
	if (!seal.bbox) return bg;
	const { x0, y0, x1, y1 } = seal.bbox;
	const stepTol = 10;
	const seedTol = 24;

	const queue = new Int32Array(W * H);
	let tail = 0;
	const seedEdge = (pts: number[]) => {
		const tones = pts.map((i) => grayGrid[i]).sort((a, b) => a - b);
		const median = tones[tones.length >> 1];
		for (const i of pts) {
			if (bg[i] === 0 && Math.abs(grayGrid[i] - median) <= seedTol) {
				bg[i] = 1;
				queue[tail++] = i;
			}
		}
	};
	const edgePts = (len: number, idx: (pos: number) => number, use: boolean) => {
		if (!use) return;
		const pts: number[] = [];
		for (let p = 0; p < len; p++) pts.push(idx(p));
		seedEdge(pts);
	};
	const bw = x1 - x0 + 1;
	const bh = y1 - y0 + 1;
	edgePts(bw, (p) => y0 * W + (x0 + p), !seal.cropped.top);
	edgePts(bw, (p) => y1 * W + (x0 + p), !seal.cropped.bottom);
	edgePts(bh, (p) => (y0 + p) * W + x0, !seal.cropped.left);
	edgePts(bh, (p) => (y0 + p) * W + x1, !seal.cropped.right);

	let head = 0;
	while (head < tail) {
		const i = queue[head++];
		const x = i % W;
		const y = (i / W) | 0;
		const v = grayGrid[i];
		const nb = [
			x > x0 ? i - 1 : -1,
			x < x1 ? i + 1 : -1,
			y > y0 ? i - W : -1,
			y < y1 ? i + W : -1,
		];
		for (const j of nb) {
			if (j >= 0 && bg[j] === 0 && Math.abs(grayGrid[j] - v) <= stepTol) {
				bg[j] = 1;
				queue[tail++] = j;
			}
		}
	}
	return bg;
}

/** Aplica a máscara: dentro da silhueta usa o negativo, fora fica branco. */
async function maskNegative(
	neg: Buffer,
	sil: Uint8Array,
	W: number,
	H: number,
): Promise<Buffer> {
	const out = Buffer.allocUnsafe(W * H);
	for (let i = 0; i < out.length; i++) {
		out[i] = sil[i] === 1 ? neg[i] : 255;
	}
	return sharp(out, { raw: { width: W, height: H, channels: 1 } })
		.png()
		.toBuffer();
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
 * Contorno vetorial da silhueta, já no sistema de coordenadas do SVG —
 * INVISÍVEL de propósito (`fill="none" stroke="none"`): a borda VISÍVEL do
 * negativo é o anel baked no raster, pixel-exato. Desenhar o contorno
 * traçado por cima duplicava a borda: o Potrace suaviza e desvia alguns px
 * da borda raster, abrindo um filete branco entre o campo e a linha
 * (visível em teste real). O path fica só como GEOMETRIA: svgToDxf extrai o
 * `d` de qualquer <path> (o DXF de foto invertida ganha a polilinha do
 * contorno) e o LightBurn importa como shape de corte.
 * Falha aqui NUNCA bloqueia o negativo — degrada pra imagem sem contorno.
 */
async function traceContourPath(
	sil: Uint8Array,
	W: number,
	H: number,
	geo: { x: number; y: number; w: number; h: number },
): Promise<string> {
	try {
		const dPx = await traceMaskToPathD(sil, W, H);
		if (!dPx) return '';
		const dVb = scaleAbsolutePathD(dPx, geo.w / W, geo.h / H, geo.x, geo.y);
		return `<path d="${dVb}" fill="none" stroke="none"/>`;
	} catch (err) {
		console.error('[silhouette-contour] contorno vetorial falhou:', err);
		return '';
	}
}

/**
 * Constrói o negativo local do SVG — inverte os tons só dentro da silhueta
 * do assunto (contorno fino incluso), preservando o desenho original e o
 * fundo verdadeiro. Ver comentário de topo do arquivo.
 */
export async function buildSilhouetteContourSvg(
	originalSvg: string,
	opts: SilhouetteContourOptions = {},
): Promise<SilhouetteContourResult> {
	// <image> = invertido persistido (ou raster embutido) — re-inverter em
	// cima geraria lixo; recusa.
	if (/<image\b/i.test(originalSvg)) {
		return { ok: false, reason: 'no_geometry' };
	}

	const geo = readSvgGeometry(originalSvg);
	if (!geo) return { ok: false, reason: 'no_geometry' };

	const maxDim = opts.maxDim ?? WORK_DIM;
	const {
		ink,
		width: W,
		height: H,
	} = await rasterizeSvgToInkMask(originalSvg, maxDim);

	let inkCount = 0;
	for (let i = 0; i < ink.length; i++) inkCount += ink[i];
	if (inkCount === 0) return { ok: false, reason: 'empty' };

	const minDim = Math.min(W, H);
	const closeR = Math.max(1, Math.round(minDim * 0.01 * CLOSE_R_MULTIPLIER));
	const marginPx = outlineMarginPx(minDim);

	// Negativo re-ditherizado primeiro: além da trama, ele libera as duas
	// ferramentas de máscara baseadas na FOTO (selagem por bbox e flood de
	// fundo) que o vetor sozinho não permite.
	const negPrep = await reditheredNegative(opts, geo, W, H);

	// Com a foto em mãos: cada aresta do bbox ou CORTA o assunto (muita
	// tinta encostada → SELA, senão área clara do assunto no corte vira
	// porta do flood e buraco branco — ex.: camiseta estourada na base) ou é
	// FUNDO (→ semente do flood de fundo, abaixo).
	const bboxSeal = negPrep ? sealAgainstBboxEdges(ink, W, H) : null;
	const inkM = bboxSeal ? bboxSeal.sealed : ink;

	// Absorve bolsões que são INTERIOR DO ASSUNTO com traço esparso (medido:
	// peito de desenho a lápis, 5% da tela, 2% de perímetro aberto, com
	// logos/traços flutuando dentro). `requireInkIsland` é o que impede de
	// engolir vãos VAZIOS entre elementos separados (arte 360°: 0,8-4,2% de
	// área, 3-11% de abertura — indistinguíveis por área/abertura, mas sem
	// nenhuma ilha de desenho dentro). Vales abertos (entre braços/cabeça,
	// 17-47% de abertura) caem no `maxOpenFraction`.
	const silBase = computeSilhouetteMask(inkM, W, H, {
		closeR,
		border: marginPx,
	});
	let sil = absorbEnclosedPockets(silBase, W, H, {
		closeR: closeR * 2,
		maxAreaFraction: 0.1,
		maxOpenFraction: 0.15,
		requireInkIsland: true,
	});
	// Poeira do fundo da foto: 1-4 pontos de dither isolados viravam, cada
	// um, um pontinho preto solto no invertido.
	sil = dropLowInkComponents(sil, inkM, W, H, speckMaxAreaPx(minDim));

	// Flood de fundo da FOTO (só no caminho re-ditherizado): remove da
	// silhueta o fundo liso/gradiente que a tinta do positivo colou no
	// assunto (ex.: sombra da parede atrás do ombro → mancha escura no
	// negativo). A erosão pela margem preserva o anel de contorno.
	if (negPrep && bboxSeal) {
		const bg = photoBackgroundMask(negPrep.grayGrid, W, H, bboxSeal);
		const bgSafe = erodeSquare(bg, W, H, marginPx + 2);
		for (let i = 0; i < sil.length; i++) {
			if (bgSafe[i] === 1) sil[i] = 0;
		}
	}

	// Suavização ANTES da escavação, mais forte que o acabamento final: as
	// bordas de regiões de dither esparso/gradiente saem do close quadrado
	// como escadas de ~2×closeR — o acabamento fino (r≈3) não alcança.
	sil = smoothMask(sil, W, H, marginPx + 4);

	// Foto sangrada → negativo da foto inteira (preenche o bbox da tinta).
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
	const bboxArea = (x1 - x0 + 1) * (y1 - y0 + 1);
	let silArea = 0;
	for (let i = 0; i < sil.length; i++) silArea += sil[i];
	const fullBleed =
		bboxArea / (W * H) >= FULL_BLEED_BBOX_FRACTION &&
		silArea / bboxArea >= FULL_BLEED_SIL_DENSITY;
	if (fullBleed) {
		// Foto sangrada inverte inteira — sem escavação de papel.
		for (let y = y0; y <= y1; y++) {
			sil.fill(1, y * W + x0, y * W + x1 + 1);
		}
	}

	// A escavação de papel NÃO roda no caminho re-ditherizado: numa FOTO,
	// região "sem tinta" no vetor positivo é highlight estourado (bochecha no
	// flash, camiseta branca) — escavá-la abre um buraco branco de borda dura
	// no meio do assunto (as "quebras" reportadas), sendo que o tom real dela
	// rende trama escura correta no negativo. A escavação de janelas de papel
	// é regra de DESENHO — e desenho roteia pro pixel-flip.
	if (!negPrep && !fullBleed) {
		// Janelas de PAPEL VAZIO dentro da figura (ex.: o vão entre o braço
		// levantado e o rosto/pescoço) ficam brancas — só interior DESENHADO
		// inverte. Piso de 0,35% da tela MEDIDO no desenho a lápis real: as
		// janelas genuínas têm ≥0,42% (7,9k-23,7k px) e os vazios de traço
		// esparso nos braços/mãos ficam ≤0,34% (até 6,3k px) — escavar esses
		// pequenos deixava o braço "quebrado", um patchwork de retângulos
		// brancos no meio da hachura. Ver `carveEmptyPaper`.
		sil = carveEmptyPaper(sil, silBase, inkM, W, H, {
			halo: marginPx + 2,
			minArea: Math.max(1500, Math.round(W * H * 0.0035)),
		});
	}

	// Arredonda os degraus do kernel quadrado da morfologia — a borda baked
	// do negativo é esta máscara, então a suavização é o acabamento visível.
	const silSmooth = smoothMask(
		sil,
		W,
		H,
		Math.max(2, Math.round(marginPx / 2)),
	);

	// Preferência: negativo re-ditherizado da foto original (fluxo manual);
	// fallback: inversão de pixel do vetor (vetores antigos sem original).
	const negatedPng = negPrep
		? await maskNegative(negPrep.neg, silSmooth, W, H)
		: await negateWithinMask(originalSvg, silSmooth, W, H);
	const b64 = negatedPng.toString('base64');
	const contourPath = await traceContourPath(silSmooth, W, H, geo);

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${geo.w}" height="${geo.h}" viewBox="${geo.x} ${geo.y} ${geo.w} ${geo.h}">` +
		`<image x="${geo.x}" y="${geo.y}" width="${geo.w}" height="${geo.h}" preserveAspectRatio="none" href="data:image/png;base64,${b64}"/>` +
		`${contourPath}</svg>`;
	return { ok: true, svg };
}
