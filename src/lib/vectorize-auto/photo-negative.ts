/**
 * Negativo de fotogravação (copo escuro) gerado LOCALMENTE, com fundo zero.
 *
 * O `mode=negative` da API upstream devolve o negativo com sobra de fundo
 * (painéis retos atrás de cabelo/ombro). Aqui o negativo é composto em raster:
 *
 *     grava = (dentro da silhueta do assunto) E (não tem traço desenhado)
 *
 * Como a composição é em pixel, não existe retângulo de viewBox para vazar nem
 * conta de alinhamento entre a silhueta local e o viewBox do upstream. A
 * hachura vira furo de verdade (contorno interno do mesmo path, evenodd).
 *
 * A silhueta vem de DUAS fontes independentes que se corrigem:
 *  - RMBG-1.4 (segmentation.ts) — ótimo em foto, pode errar em arte de linha;
 *  - flood fill a partir da borda sobre os pixels sem tinta — de graça, exato
 *    quando o contorno nanquim está fechado.
 * Na dúvida usa a interseção: o fundo só sobrevive se as DUAS falharem.
 *
 * Quando há silhueta da FOTO (segmentação do no_background ou alpha do upload),
 * ela manda: a foto tem a roupa clara inteira, enquanto a arte de linha perde
 * pedaços de suéter claro e pontilhado (viravam buracos pretos na gravação).
 * As duas fontes acima ficam de reserva para quando ela não alinhar.
 *
 * Com a foto em mãos, o negativo também ganha o TOM dela (meio-tom por difusão
 * de erro): sem ele a pele virava uma chapa prata lisa ("adesivo") e só o
 * traço da IA desenhava o rosto. Fica
 *
 *     grava = silhueta E (não é traço) E ponto do meio-tom da foto
 *
 * e o mesmo módulo traça o POSITIVO do copo claro (grava = traço, dentro da
 * silhueta da foto um pouco dilatada).
 */
import sharp from 'sharp';
import { UpstreamError } from './errors.js';
import {
	maskSlackPx,
	resizeSubjectMask,
	type SubjectMask,
} from './photo-background.js';
import { segmentSubjectPng } from './segmentation.js';
import { buildAlphaMask } from './vector/color-quantize.js';
import {
	applyBorderFade,
	type DiffusionKernel,
	errorDiffusionDither,
	isDiffusionKernel,
} from './vector/dither.js';
import {
	closeMask,
	dilateMask,
	dropSmallIslands,
	erodeMask,
	fillInteriorHoles,
	growRemovalThroughNonInk,
	localInkDensity,
	maskCoverage,
	subjectByBackgroundDensity,
	unionMasks,
} from './vector/mask-ops.js';
import { maskToPng, TRACE_OPTS, tracePromise } from './vector/potrace-utils.js';

/** Alpha do RMBG acima disso = sujeito (mesmo corte do StickerAI). */
const ALPHA_THRESHOLD = 128;
/** Raio do fechamento morfológico: costura vãos de 1-3px no contorno/cabelo. */
const CLOSE_PX = 3;
/** Cobertura plausível para uma silhueta (fora disso a máscara é lixo). */
const MIN_COVERAGE = 0.03;
const MAX_COVERAGE = 0.97;
/** Densidade local de tinta abaixo disso = área vazia (painel de fundo). */
const PANEL_MAX_INK_DENSITY = 0.02;
/** Janela (px) e teto de tinta que definem "área vazia" = fundo. */
const BG_DENSITY_RADIUS = 12;
const BG_MAX_INK_DENSITY = 0.02;
/** Raio da janela de densidade, como fração do lado da imagem. */
const DENSITY_RADIUS_RATIO = 0.04;
/** Ilha da silhueta menor que isso (fração da maior) é mancha do segmentador. */
const MIN_ISLAND_FRACTION = 0.05;
/** Autoconferência da silhueta da foto: se o corte pela arte + ilhas levarem
 *  mais que 3% dela, quem errou foi o corte (comeu braço/tronco) — volta sem. */
const PHOTO_SELF_CHECK_RATIO = 0.97;
/** Folga extra (px na grade) da silhueta da foto no positivo do copo claro. */
const POSITIVE_GROW_PX = 2;
/** Grade do positivo (lado maior): a arte da IA vem com ~1400 px e só tem
 *  traço — vale traçar na resolução dela (o motor reduzia para 800). */
const POSITIVE_MAX_SIDE = 1600;
/**
 * Teto do SVG. A resposta da Vercel morre em ~4,5 MB e leva o SVG dentro de um
 * JSON (+ créditos e stats): acima disso o pedido falha inteiro. O meio-tom é
 * o que mais pesa (cada ponto vira um subpath).
 */
const PHOTO_SVG_MAX_BYTES = 4_300_000;
/**
 * Lado do ponto do meio-tom, em px da grade (1200). Comparado lado a lado na
 * selfie de casal e no retrato (24/10/2026): com ponto de 2 px e sacudida ±32 o
 * rosto saía "areia" no copo preto; ponto de 1 px com Stucki e sacudida ±12
 * deixa a pele lisa e o olho/sorriso legíveis, e o SVG ficou MENOR (0,6-1,2 MB
 * contra 1,5-1,6 MB), porque o Stucki junta os pontos em manchas maiores.
 */
const TONE_CELL_PX = 1;
/** Corte dos percentis no esticamento do tom (1% de cada ponta, só no sujeito). */
const TONE_STRETCH = 0.01;
/** Contraste local (CLAHE): janela em px da grade da arte e inclinação máxima. */
const TONE_CLAHE_PX = 64;
const TONE_CLAHE_SLOPE = 2;
/** Suavização antes do meio-tom (px da grade da arte): tira o grão da foto sem borrar o rosto. */
const TONE_BLUR_SIGMA = 1.2;
/** Gama < 1 abre os meios-tons (pele) — no inox o claro é o que aparece. Com
 *  0,7 os rostos da selfie de teste gravam a mesma densidade do protótipo
 *  aprovado (F2); 0,8 saía ~10% mais escuro, porque o traço da IA também come luz. */
const TONE_GAMMA = 0.7;
/** Esmaecimento nas bordas da imagem, em fração do lado. */
const TONE_BORDER_FADE = 0.07;
/** Sacudida do limiar do meio-tom (±, em 0..255) contra listras regulares;
 *  ±32 virava grão visível na pele. */
const TONE_NOISE = 12;
/** Algoritmo do meio-tom: Stucki dá a pele mais lisa nas fotos de teste. */
const TONE_KERNEL: DiffusionKernel = 'stucki';
/**
 * O tom da foto só escurece onde a arte da IA está ABERTA (pele, camiseta clara:
 * papel sem hachura). Onde ela já hachurou, o tom está no próprio desenho — pelo
 * preto, roupa escura —, e o meio-tom por cima escurecia duas vezes: o cachorro
 * preto perdia olho e orelha e a roupa virava areia. Acima desta fração de traço
 * na vizinhança (TONE_OPEN_SIGMA) o meio-tom não age; abaixo, entra aos poucos.
 */
const TONE_OPEN_INK = 0.2;
/** Raio (sigma, px da grade da arte) da vizinhança que mede a densidade do traço. */
const TONE_OPEN_SIGMA = 6;

export interface PhotoNegativeOptions {
	/** gray < isso = traço desenhado, para SILHUETA (flood, densidade, painel).
	 *  Default 128 (env PHOTO_INK_THRESHOLD). */
	inkThreshold?: number;
	/** gray < isso = traço, na hora de decidir o que GRAVA. Separado do
	 *  inkThreshold porque a silhueta e a gravação querem cortes diferentes:
	 *  medido, subir esse valor engrossa a área escura mas come cabelo e roupa.
	 *  Default 128 (env PHOTO_ENGRAVE_THRESHOLD). */
	engraveThreshold?: number;
	/** Lado máximo da grade de trabalho. Default 1200 (igual ao StickerAI); no
	 *  positivo com a silhueta da foto 1600 (a resolução da arte). */
	maxSide?: number;
	/** Suavização (sigma) do cinza só para a decisão de gravação. Default 0:
	 *  medido nesta arte, borrar arredonda a malha do tecido mas engole hachura
	 *  fina de cabelo e olhos — só vale a pena se a arte vier muito ruidosa.
	 *  (env PHOTO_BLUR_SIGMA) */
	blurSigma?: number;
	/** Erosão da silhueta, em px — mata o anel gravado na borda. Default 2. */
	erodePx?: number;
	/** Ilhas soltas da silhueta abaixo dessa fração da maior saem (manchas do
	 *  RMBG no fundo branco). 0 desliga. Default 0.05 (env PHOTO_MIN_ISLAND_FRACTION). */
	minIslandFraction?: number;
	/** Área mínima de ilha/furo no potrace. Default 2 (TRACE_OPTS). */
	turdSize?: number;
	/** 'negative' = grava o entorno do traço (copo escuro). 'positive' = grava o traço. */
	polarity?: 'negative' | 'positive';
	/** Devolve também as máscaras intermediárias em PNG (diagnóstico de dev). */
	includeMasks?: boolean;
	/** Silhueta da FOTO original (com a folga de `subjectMaskFromCutout`). Quando
	 *  alinha com a arte, substitui o RMBG da arte + flood. `source: 'alpha'`
	 *  (recorte do upload) vale como veio; sem source passa pelo corte da arte
	 *  (segmentação da cena). Com `onWhitePng`, o negativo ganha o tom da foto. */
	photoSubject?: Pick<SubjectMask, 'mask' | 'width' | 'height'> &
		Partial<Pick<SubjectMask, 'source' | 'onWhitePng'>>;
	/** Folga extra da silhueta da foto no positivo, em px. Default 2
	 *  (env PHOTO_POSITIVE_GROW_PX). */
	positiveGrowPx?: number;
	/** Meio-tom da foto no negativo. Default: ligado quando photoSubject traz
	 *  onWhitePng (env PHOTO_TONE=0 desliga). */
	tone?: boolean;
	/** Algoritmo do meio-tom. Default TONE_KERNEL (env PHOTO_TONE_KERNEL). */
	toneKernel?: DiffusionKernel;
	/** Teto do SVG em bytes; acima dele a grade encolhe. Default PHOTO_SVG_MAX_BYTES. */
	maxSvgBytes?: number;
}

/** Silhueta da foto já na grade da arte (ver photoSilhouette). */
interface PhotoSilhouette {
	mask: Buffer;
	origin: 'alpha' | 'segmentation';
	/** Passou pelo corte da arte (só segmentação). */
	clipped: boolean;
	/** O corte/ilhas comeram demais e a silhueta voltou sem eles. */
	fallback: boolean;
	islandsRemoved: number;
}

export interface PhotoNegativeResult {
	/** SVG cru do potrace: um <path> com fill-rule evenodd, viewBox="0 0 W H". */
	svg: string;
	width: number;
	height: number;
	/** Diagnóstico: fração da imagem ocupada pela silhueta final. */
	subjectCoverage: number;
	/** Qual fonte definiu a silhueta. */
	source: 'foto' | 'uniao' | 'uniao-rmbg-corte' | 'art-flood' | 'rmbg';
	/** Quantos pixels de painel de fundo o RMBG derrubou. */
	panelsRemoved: number;
	/** Quantos pixels de ilhas soltas (manchas no fundo) saíram da silhueta. */
	islandsRemoved: number;
	/** Diagnóstico (só com includeMasks): silhueta e máscara gravada, em PNG. */
	masks?: { subject: Buffer; engraved: Buffer };
	/** Diagnóstico por fonte (null quando a fonte não rodou). */
	coverage: { rmbg: number | null; artFlood: number };
	/** Silhueta da foto: origem, corte pela arte e reserva. Null = não usada. */
	photo: Omit<PhotoSilhouette, 'mask' | 'islandsRemoved'> | null;
	/** Meio-tom da foto aplicado. Null = 1 bit (só a arte). */
	tone: { kernel: DiffusionKernel } | null;
	/** turdSize usado no potrace. */
	turdSize: number;
	/** Tamanho do SVG cru, em bytes. */
	svgBytes: number;
	/** Quantas grades foram tentadas até caber no teto (1 = a primeira). */
	attempts: number;
}

function envInt(name: string, fallback: number): number {
	const v = Number(process.env[name]);
	return Number.isFinite(v) ? v : fallback;
}

/**
 * Compõe a máscara a ser traçada. `polarity: 'negative'` grava tudo que está
 * dentro da silhueta e não é traço (a hachura fica branca = furo). Com `tone`
 * (1 = ponto do meio-tom), só grava onde também há ponto: sombra da foto fica
 * com pouco inox, luz fica cheia, e o traço da IA continua sem gravar.
 */
export function composeMask(
	subject: Buffer,
	gray: Buffer | Uint8Array,
	inkThreshold: number,
	polarity: 'negative' | 'positive',
	tone?: Uint8Array,
): Buffer {
	const out = Buffer.alloc(subject.length, 255);
	for (let i = 0; i < out.length; i++) {
		if (subject[i] !== 0) continue; // fora da silhueta: nunca grava
		const isInk = gray[i] < inkThreshold;
		const engrave = polarity === 'negative' ? !isInk : isInk;
		if (engrave && (!tone || tone[i])) out[i] = 0;
	}
	return out;
}

/**
 * 1 onde o pixel está entre desenho na própria linha (há seleção à esquerda e à
 * direita) ou, com `columns`, na própria coluna (acima e abaixo).
 */
function betweenDrawing(
	mask: Buffer,
	w: number,
	h: number,
	columns = true,
): Uint8Array {
	const out = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		let first = -1;
		let last = -1;
		for (let x = 0; x < w; x++) {
			if (mask[y * w + x] !== 0) continue;
			if (first < 0) first = x;
			last = x;
		}
		for (let x = first + 1; x < last; x++) out[y * w + x] = 1;
	}
	if (!columns) return out;
	for (let x = 0; x < w; x++) {
		let first = -1;
		let last = -1;
		for (let y = 0; y < h; y++) {
			if (mask[y * w + x] !== 0) continue;
			if (first < 0) first = y;
			last = y;
		}
		for (let y = first + 1; y < last; y++) out[y * w + x] = 1;
	}
	return out;
}

/**
 * Combina as duas silhuetas. Cada uma erra de um jeito, medido em fotos reais:
 *  - o RMBG (treinado em foto) engole regiões claras de arte de linha — num
 *    retrato ele descartou o tronco inteiro (0,34 contra 0,59 do flood);
 *  - o "fundo vazio" perde parte clara e pouco desenhada do assunto encostada
 *    no fundo — a cara branca de um gato sumiu por isso.
 * Como os dois erram por FALTA, a base é a UNIÃO. Depois o RMBG derruba do
 * resultado o que só o flood trouxe E que não tem desenho nenhum — a assinatura
 * de um painel de fundo em branco. Excedente com tinta é desenho e fica.
 */
function refineSubject(
	artInterior: Buffer,
	rmbg: Buffer | null,
	gray: Buffer | Uint8Array,
	w: number,
	h: number,
	inkThreshold: number,
): {
	mask: Buffer;
	source: PhotoNegativeResult['source'];
	panelsRemoved: number;
} {
	const cA = maskCoverage(artInterior);
	const artOk = cA >= MIN_COVERAGE && cA <= MAX_COVERAGE;

	if (!rmbg) {
		if (!artOk)
			throw new UpstreamError('Não foi possível isolar o assunto na arte.');
		return { mask: artInterior, source: 'art-flood', panelsRemoved: 0 };
	}

	const cR = maskCoverage(rmbg);
	const rmbgOk = cR >= MIN_COVERAGE && cR <= MAX_COVERAGE;
	if (!artOk) {
		if (!rmbgOk)
			throw new UpstreamError('A segmentação não encontrou o assunto na arte.');
		return { mask: rmbg, source: 'rmbg', panelsRemoved: 0 };
	}
	if (!rmbgOk)
		return { mask: artInterior, source: 'art-flood', panelsRemoved: 0 };

	const base = unionMasks(artInterior, rmbg);

	// O RMBG só pode DERRUBAR o excedente do flood — e só onde esse excedente for
	// uma área sem desenho nenhum. Densidade local (e não componente conexo)
	// porque o painel costuma encostar no assunto: os dois viram um blob só.
	const radius = Math.max(8, Math.round(DENSITY_RADIUS_RATIO * Math.max(w, h)));
	const density = localInkDensity(gray, w, h, inkThreshold, radius);
	const out = Buffer.from(base);
	let removed = 0;
	for (let i = 0; i < out.length; i++) {
		if (out[i] !== 0 || rmbg[i] === 0) continue; // só o excedente do flood
		if (density[i] >= PANEL_MAX_INK_DENSITY) continue; // tem desenho: é o assunto
		out[i] = 255;
		removed++;
	}
	// A janela de densidade deixa um halo em volta do traço: expande a remoção
	// por pixels sem tinta até encostar no desenho.
	const grown =
		removed > 0
			? growRemovalThroughNonInk(out, base, gray, w, h, inkThreshold)
			: 0;
	// O inverso também acontece: o RMBG marca como assunto um pedaço de parede
	// vazia colado no corpo (ou uma faixa abaixo do corte). Excedente do RMBG só
	// fica se estiver ENTRE desenho — na linha ou na coluna — e ainda perto dele
	// ou com tinta em volta: a cara clara entre olhos e focinho fica; a
	// prateleira pendurada no corte e o painel ao lado da orelha saem.
	// Roda DEPOIS do crescimento acima de propósito: crescer a partir daqui
	// comeria o peito claro (pouco desenhado) do assunto.
	const nearDrawing = dilateMask(artInterior, w, h, radius);
	const between = betweenDrawing(artInterior, w, h);
	let farFromDrawing = 0;
	for (let i = 0; i < out.length; i++) {
		if (out[i] !== 0 || artInterior[i] === 0) continue; // só o excedente do RMBG
		// Fora do vão do desenho (nem na linha nem na coluna) sai mesmo com tinta
		// por perto: é o halo do alpha passando da borda do traço.
		if (
			between[i] &&
			(nearDrawing[i] === 0 || density[i] >= PANEL_MAX_INK_DENSITY)
		)
			continue;
		out[i] = 255;
		farFromDrawing++;
	}
	const panelsRemoved = removed + grown + farFromDrawing;

	return {
		mask: out,
		source: panelsRemoved > 0 ? 'uniao-rmbg-corte' : 'uniao',
		panelsRemoved,
	};
}

/**
 * Silhueta da foto na grade da arte. Null quando não alinha (proporção) ou sai
 * implausível — aí vale a silhueta da arte.
 *
 * Recorte do upload (`source: 'alpha'`): vale como veio. O grava_ai já manda o
 * sujeito limpo, e cortá-lo pela arte (abaixo) é o que gravava degraus e uma
 * reta horizontal atravessando o braço da selfie: a arte desenha o braço claro
 * quase sem traço, então a linha inteira caía fora do "vão" do desenho.
 *
 * Segmentação da cena (RMBG): às vezes deixa manchas do cenário (parede
 * texturizada) que na arte são branco puro: só fica o que está no interior da
 * arte (flood do fundo vazio) ou ENTRE o desenho na mesma linha. O suéter claro
 * pontilhado tem tinta e está no interior; a mancha ao lado do pet não. Só a
 * linha: na coluna, a orelha em cima e o corpo embaixo "abraçam" o vão ao lado
 * do pescoço, e a mancha do cenário ali virava um painel gravado.
 *
 * Autoconferência: se o corte + as ilhas levarem mais de 3% da silhueta (fora o
 * anel da folga), quem errou foi o corte (comeu o assunto) — volta a silhueta
 * da foto sem corte.
 *
 * Negativo: tira a folga e erode (mata o anel gravado na borda). Positivo (copo
 * claro): mantém a folga e cresce `growPx` — o contorno nanquim fica POR FORA do
 * sujeito e, com a silhueta erodida, o contorno dos braços sumia.
 */
async function photoSilhouette(
	photo: NonNullable<PhotoNegativeOptions['photoSubject']>,
	artInterior: Buffer,
	W: number,
	H: number,
	opts: {
		erodePx: number;
		growPx: number;
		polarity: 'negative' | 'positive';
		minIslandFraction: number;
	},
): Promise<PhotoSilhouette | null> {
	const resized = await resizeSubjectMask(photo, W, H);
	if (!resized) return null;
	// A folga foi somada na grade da máscara: converte para a grade da arte.
	const slack = Math.round(
		(maskSlackPx(photo.width, photo.height) * W) / photo.width,
	);
	const shape = (m: Buffer): Buffer => {
		if (opts.polarity === 'positive')
			return opts.growPx > 0 ? dilateMask(m, W, H, opts.growPx) : m;
		const erode = slack + opts.erodePx;
		return erode > 0 ? erodeMask(m, W, H, erode) : m;
	};

	const base = shape(resized);
	const c = maskCoverage(base);
	if (c < MIN_COVERAGE || c > MAX_COVERAGE) {
		console.warn(
			`[photo-negative] silhueta da foto implausível (cobertura ${c.toFixed(3)}) — usando a da arte`,
		);
		return null;
	}

	const origin = photo.source === 'alpha' ? 'alpha' : 'segmentation';
	let mask = base;
	if (origin === 'segmentation') {
		const between = betweenDrawing(artInterior, W, H, false);
		const clipped = Buffer.from(resized);
		for (let i = 0; i < clipped.length; i++) {
			if (clipped[i] === 0 && artInterior[i] !== 0 && !between[i])
				clipped[i] = 255;
		}
		mask = shape(clipped);
	}
	// O RMBG às vezes marca manchas soltas no fundo — no copo escuro cada uma
	// vira um borrão gravado em volta do assunto.
	const islands =
		opts.minIslandFraction > 0
			? dropSmallIslands(mask, W, H, opts.minIslandFraction)
			: { mask, removed: 0 };
	// Conta só o que saiu ALÉM do anel da folga: o corte encosta a silhueta no
	// contorno da arte e a erosão come a folga de novo — esse anel é esperado.
	const regrow = slack + (opts.polarity === 'negative' ? opts.erodePx : 0);
	const back =
		regrow > 0 ? dilateMask(islands.mask, W, H, regrow) : islands.mask;
	let inBase = 0;
	let kept = 0;
	for (let i = 0; i < base.length; i++) {
		if (base[i] !== 0) continue;
		inBase++;
		if (back[i] === 0) kept++;
	}
	if (kept < PHOTO_SELF_CHECK_RATIO * inBase) {
		console.warn(
			`[photo-negative] corte da silhueta levou ${((1 - kept / inBase) * 100).toFixed(1)}% da foto — usando a silhueta da foto sem corte`,
		);
		return {
			mask: base,
			origin,
			clipped: false,
			fallback: true,
			islandsRemoved: 0,
		};
	}
	return {
		mask: islands.mask,
		origin,
		clipped: origin === 'segmentation',
		fallback: false,
		islandsRemoved: islands.removed,
	};
}

/** Valor do histograma no percentil `p` (0..1) de `n` amostras. */
function histPercentile(hist: Uint32Array, n: number, p: number): number {
	const target = n * p;
	let acc = 0;
	for (let v = 0; v < 256; v++) {
		acc += hist[v];
		if (acc >= target) return v;
	}
	return 255;
}

/**
 * Meio-tom da foto na grade da arte: 1 = ponto (grava, vira inox), 0 = não.
 *
 * A foto (sujeito sobre branco) é reamostrada para a MESMA grade da arte — a IA
 * devolve o enquadramento e a proporção da entrada, então traço e tom caem no
 * mesmo lugar. Antes do meio-tom:
 *  - esticamento pelos percentis de 1% DENTRO da silhueta e fundo trocado pela
 *    média do sujeito, para o branco de fora não puxar a borda para o escuro;
 *  - contraste local (CLAHE) — o rosto na sombra da aba do boné continua legível;
 *  - blur leve (tira o grão da foto) e gama 0,7 (abre a pele);
 *  - esmaecimento nas bordas da imagem (braço que sai da foto não termina em reta).
 */
async function photoToneDots(
	photoOnWhitePng: Buffer,
	subject: Buffer,
	W: number,
	H: number,
	kernel: DiffusionKernel,
	cellPx: number,
	inkDensity?: Buffer,
): Promise<Uint8Array> {
	// Grade do ponto (TONE_CELL_PX): o meio-tom roda numa grade `cellPx` vezes
	// menor e cada ponto vira um bloco cellPx×cellPx na grade da arte (o traço da
	// IA continua na resolução cheia).
	const cw = Math.max(1, Math.round(W / cellPx));
	const ch = Math.max(1, Math.round(H / cellPx));
	const cellIndex = (cx: number, cy: number) =>
		Math.min(H - 1, Math.floor(((cy + 0.5) * H) / ch)) * W +
		Math.min(W - 1, Math.floor(((cx + 0.5) * W) / cw));
	const inCell = new Uint8Array(cw * ch);
	for (let cy = 0; cy < ch; cy++)
		for (let cx = 0; cx < cw; cx++)
			inCell[cy * cw + cx] = subject[cellIndex(cx, cy)];

	const { data } = await sharp(photoOnWhitePng, { failOn: 'none' })
		.resize(cw, ch, { fit: 'fill' })
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const hist = new Uint32Array(256);
	let n = 0;
	let sum = 0;
	for (let i = 0; i < inCell.length; i++) {
		if (inCell[i] !== 0) continue;
		hist[data[i]]++;
		n++;
		sum += data[i];
	}
	if (n === 0) return new Uint8Array(W * H);
	const mean = sum / n;
	const lo = histPercentile(hist, n, TONE_STRETCH);
	const hi = Math.max(lo + 1, histPercentile(hist, n, 1 - TONE_STRETCH));
	const stretched = Buffer.alloc(cw * ch);
	for (let i = 0; i < stretched.length; i++) {
		const v = inCell[i] === 0 ? data[i] : mean;
		stretched[i] = Math.max(
			0,
			Math.min(255, Math.round(((v - lo) * 255) / (hi - lo))),
		);
	}

	const tile = Math.max(8, Math.round(TONE_CLAHE_PX / cellPx));
	const { data: local } = await sharp(stretched, {
		raw: { width: cw, height: ch, channels: 1 },
	})
		.clahe({ width: tile, height: tile, maxSlope: TONE_CLAHE_SLOPE })
		.blur(Math.max(0.3, TONE_BLUR_SIGMA / cellPx))
		// sharp devolve 3 canais por padrão; o tom é 1 canal.
		.extractChannel(0)
		.raw()
		.toBuffer({ resolveWithObject: true });
	const tone = new Float32Array(cw * ch);
	const gamma = Number(process.env.PHOTO_TONE_GAMMA ?? TONE_GAMMA);
	for (let i = 0; i < tone.length; i++)
		tone[i] = 255 * (local[i] / 255) ** gamma;
	const openInk = Number(process.env.PHOTO_TONE_OPEN_INK ?? TONE_OPEN_INK);
	if (inkDensity && openInk > 0) {
		// Densidade do traço (0-255) na grade do tom; 1 = arte aberta, 0 = já hachurada.
		const dens =
			cw === W && ch === H
				? inkDensity
				: await sharp(inkDensity, { raw: { width: W, height: H, channels: 1 } })
						.resize(cw, ch, { fit: 'fill' })
						.raw()
						.toBuffer();
		for (let i = 0; i < tone.length; i++) {
			const aberta = Math.max(0, Math.min(1, 1 - dens[i] / (255 * openInk)));
			tone[i] = 255 - aberta * (255 - tone[i]);
		}
	}
	applyBorderFade(tone, cw, ch, TONE_BORDER_FADE);
	const dots = errorDiffusionDither(
		tone,
		cw,
		ch,
		kernel,
		inCell,
		Number(process.env.PHOTO_TONE_NOISE ?? TONE_NOISE),
	);
	if (cw === W && ch === H) return dots;
	const out = new Uint8Array(W * H);
	for (let y = 0; y < H; y++) {
		const row = Math.min(ch - 1, Math.floor((y * ch) / H)) * cw;
		for (let x = 0; x < W; x++)
			out[y * W + x] = dots[row + Math.min(cw - 1, Math.floor((x * cw) / W))];
	}
	return out;
}

/** Densidade local do traço da arte (0-255): fração de tinta numa vizinhança de TONE_OPEN_SIGMA. */
async function inkDensityMap(
	gray: Buffer | Uint8Array,
	W: number,
	H: number,
	inkThreshold: number,
): Promise<Buffer> {
	const ink = Buffer.alloc(W * H);
	for (let i = 0; i < ink.length; i++)
		ink[i] = gray[i] < inkThreshold ? 255 : 0;
	return sharp(ink, { raw: { width: W, height: H, channels: 1 } })
		.blur(TONE_OPEN_SIGMA)
		.extractChannel(0)
		.raw()
		.toBuffer();
}

/** Configuração resolvida de uma passada (opções + env). */
interface BuildConfig {
	inkThreshold: number;
	engraveThreshold: number;
	blurSigma: number;
	maxSide: number;
	erodePx: number;
	growPx: number;
	minIslandFraction: number;
	turdSize: number;
	polarity: 'negative' | 'positive';
	toneKernel: DiffusionKernel | null;
	toneCellPx: number;
}

/**
 * Monta o negativo (ou o positivo) recortado pela silhueta do assunto.
 *
 * Com o tom da foto, o SVG pode passar do teto da resposta: a grade encolhe
 * (×0,85, até 2 vezes) e, se nem assim couber, sai em 1 bit, sem o tom.
 *
 * @param cleanedArtPng saída de `cleanNanquimArt` (nanquim P&B, fundo branco).
 * @throws UpstreamError quando a silhueta sai implausível ou a segmentação falha.
 */
export async function buildPhotoNegativeSvg(
	cleanedArtPng: Buffer,
	opts: PhotoNegativeOptions = {},
): Promise<PhotoNegativeResult> {
	const polarity = opts.polarity ?? 'negative';
	const envKernel = process.env.PHOTO_TONE_KERNEL;
	const wantsTone =
		polarity === 'negative' &&
		!!opts.photoSubject?.onWhitePng &&
		(opts.tone ?? process.env.PHOTO_TONE !== '0');
	const toneKernel = wantsTone
		? (opts.toneKernel ??
			(isDiffusionKernel(envKernel) ? envKernel : TONE_KERNEL))
		: null;
	const cfg: BuildConfig = {
		inkThreshold: opts.inkThreshold ?? envInt('PHOTO_INK_THRESHOLD', 128),
		engraveThreshold:
			opts.engraveThreshold ?? envInt('PHOTO_ENGRAVE_THRESHOLD', 128),
		blurSigma: opts.blurSigma ?? Number(process.env.PHOTO_BLUR_SIGMA ?? 0),
		maxSide:
			opts.maxSide ??
			(polarity === 'positive' && opts.photoSubject ? POSITIVE_MAX_SIDE : 1200),
		erodePx: opts.erodePx ?? envInt('PHOTO_NEGATIVE_ERODE_PX', 2),
		growPx:
			opts.positiveGrowPx ?? envInt('PHOTO_POSITIVE_GROW_PX', POSITIVE_GROW_PX),
		minIslandFraction:
			opts.minIslandFraction ??
			Number(process.env.PHOTO_MIN_ISLAND_FRACTION ?? MIN_ISLAND_FRACTION),
		// O ponto do meio-tom tem 2×2 px (área 4): passa pelo turdSize padrão.
		turdSize: opts.turdSize ?? TRACE_OPTS.turdSize ?? 2,
		polarity,
		toneKernel,
		toneCellPx: Math.max(1, envInt('PHOTO_TONE_CELL', TONE_CELL_PX)),
	};
	const maxBytes = opts.maxSvgBytes ?? PHOTO_SVG_MAX_BYTES;

	let res: PhotoNegativeResult | null = null;
	for (let attempt = 1; attempt <= 3; attempt++) {
		// Encolhe a partir da grade que saiu (arte menor que o teto não amplia).
		const maxSide: number = res
			? Math.round(Math.max(res.width, res.height) * 0.85)
			: cfg.maxSide;
		res = {
			...(await buildOnce(cleanedArtPng, opts, { ...cfg, maxSide })),
			attempts: attempt,
		};
		if (res.svgBytes <= maxBytes) return res;
		console.warn(
			`[photo-negative] SVG de ${(res.svgBytes / 1e6).toFixed(2)} MB passa do teto de ${(maxBytes / 1e6).toFixed(2)} MB na grade ${res.width}x${res.height} — reduzindo`,
		);
	}
	if (!res!.tone) return res!;
	// Último recurso: 1 bit, na grade de sempre (ordem de grandeza menor).
	console.warn(
		'[photo-negative] SVG com tom não coube no teto — saindo sem o tom da foto',
	);
	return {
		...(await buildOnce(cleanedArtPng, opts, { ...cfg, toneKernel: null })),
		attempts: res!.attempts + 1,
	};
}

/** Uma passada completa (grade → silhueta → composição → trace). */
async function buildOnce(
	cleanedArtPng: Buffer,
	opts: PhotoNegativeOptions,
	cfg: BuildConfig,
): Promise<Omit<PhotoNegativeResult, 'attempts'>> {
	const {
		inkThreshold,
		engraveThreshold,
		blurSigma,
		maxSide,
		erodePx,
		minIslandFraction,
		turdSize,
		polarity,
	} = cfg;

	// ─── 1. Uma grade de trabalho só ───
	// Redimensionar ANTES da segmentação e da leitura em cinza é o que garante
	// que as duas máscaras dividam o mesmo grid de pixels. sRGB porque
	// cleanNanquimArt emite PNG de 1 canal e o modelo espera 3.
	const work = await sharp(cleanedArtPng, { failOn: 'none' })
		.flatten({ background: '#ffffff' })
		.resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
		.toColourspace('srgb')
		.png()
		.toBuffer();

	const { data: gray, info } = await sharp(work)
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const W = info.width;
	const H = info.height;

	// ─── 2. Silhueta B (da arte): o que sobra depois de tirar o fundo vazio ───
	const bgDensity = localInkDensity(
		gray,
		W,
		H,
		inkThreshold,
		BG_DENSITY_RADIUS,
	);
	const artInterior = subjectByBackgroundDensity(
		gray,
		bgDensity,
		W,
		H,
		inkThreshold,
		BG_MAX_INK_DENSITY,
	);

	// ─── 3. Silhueta da foto: quando alinha, é a silhueta (pula 4-5) ───
	const fromPhoto = opts.photoSubject
		? await photoSilhouette(opts.photoSubject, artInterior, W, H, {
				erodePx,
				growPx: cfg.growPx,
				polarity,
				minIslandFraction,
			})
		: null;

	// ─── 4. Silhueta A: RMBG (falha não é fatal — o flood da arte cobre) ───
	let rmbg: Buffer | null = null;
	if (!fromPhoto) {
		try {
			const cutout = await segmentSubjectPng(work);
			const { data: rgba } = await sharp(cutout, { failOn: 'none' })
				.ensureAlpha()
				.resize(W, H, { fit: 'fill' })
				.raw()
				.toBuffer({ resolveWithObject: true });
			rmbg = buildAlphaMask(rgba, ALPHA_THRESHOLD, W, H);
			// Fecha vãos finos (fios de cabelo) e recupera o interior claro que o
			// modelo tenha marcado como fundo.
			rmbg = fillInteriorHoles(closeMask(rmbg, W, H, CLOSE_PX), W, H);
		} catch (err) {
			console.error(
				'[photo-negative] segmentação indisponível, usando só o flood da arte:',
				err,
			);
			rmbg = null;
		}
	}

	let chosen: { source: PhotoNegativeResult['source']; panelsRemoved: number };
	let subject: Buffer;
	let islandsRemoved: number;
	if (fromPhoto) {
		// Ilhas já saíram em photoSilhouette (a autoconferência precisa delas).
		chosen = { source: 'foto', panelsRemoved: 0 };
		subject = fromPhoto.mask;
		islandsRemoved = fromPhoto.islandsRemoved;
	} else {
		// ─── 5. Combinação + erosão (o alpha do RMBG é suavizado; sem erodir sobra um
		//         anel gravado logo fora do contorno desenhado) ───
		const refined = refineSubject(artInterior, rmbg, gray, W, H, inkThreshold);
		chosen = refined;
		const eroded =
			erodePx > 0 ? erodeMask(refined.mask, W, H, erodePx) : refined.mask;
		// O RMBG às vezes marca manchas soltas no fundo branco da arte — no copo
		// escuro cada uma vira um borrão gravado em volta do assunto. A refineSubject
		// só corta o excedente do flood; aqui saem as ilhas pequenas.
		const islands =
			minIslandFraction > 0
				? dropSmallIslands(eroded, W, H, minIslandFraction)
				: { mask: eroded, removed: 0 };
		subject = islands.mask;
		islandsRemoved = islands.removed;
	}
	const subjectCoverage = maskCoverage(subject);
	if (subjectCoverage < MIN_COVERAGE || subjectCoverage > 0.98) {
		throw new UpstreamError(
			'A silhueta do assunto saiu implausível — negativo abortado.',
		);
	}

	// Cinza suavizado só para a decisão de gravação — a silhueta continua sendo
	// calculada no cinza cru, para o flood não vazar por borda borrada.
	const engraveGray =
		blurSigma > 0
			? (
					await sharp(work)
						.grayscale()
						.blur(blurSigma)
						.raw()
						.toBuffer({ resolveWithObject: true })
				).data
			: gray;

	// ─── 6. Tom da foto (só negativo com a foto alinhada) ───
	const toneKernel = fromPhoto && cfg.toneKernel ? cfg.toneKernel : null;
	const tone = toneKernel
		? await photoToneDots(
				opts.photoSubject!.onWhitePng!,
				subject,
				W,
				H,
				toneKernel,
				cfg.toneCellPx,
				await inkDensityMap(engraveGray, W, H, engraveThreshold),
			)
		: undefined;

	// ─── 7. Composição + trace ───
	// TRACE_OPTS.blackOnWhite é true: o potrace traça os ZEROS. Fora da silhueta
	// tudo é 255 e nunca é traçado → fundo zero, sem retângulo nenhum.
	const composed = composeMask(
		subject,
		engraveGray,
		engraveThreshold,
		polarity,
		tone,
	);
	const png = await maskToPng(composed, W, H);
	// No meio-tom, dois pontos que se tocam na diagonal ficam separados
	// ('majority'): no padrão ('minority') o potrace os emendava em "minhocas".
	const svg = await tracePromise(png, {
		...TRACE_OPTS,
		turdSize,
		...(tone ? { turnPolicy: 'majority' } : {}),
	});
	const masks = opts.includeMasks
		? { subject: await maskToPng(subject, W, H), engraved: png }
		: undefined;

	return {
		svg,
		width: W,
		height: H,
		subjectCoverage,
		source: chosen.source,
		panelsRemoved: chosen.panelsRemoved,
		islandsRemoved,
		coverage: {
			rmbg: rmbg ? maskCoverage(rmbg) : null,
			artFlood: maskCoverage(artInterior),
		},
		photo: fromPhoto
			? {
					origin: fromPhoto.origin,
					clipped: fromPhoto.clipped,
					fallback: fromPhoto.fallback,
				}
			: null,
		tone: toneKernel ? { kernel: toneKernel } : null,
		turdSize,
		svgBytes: Buffer.byteLength(svg),
		...(masks ? { masks } : {}),
	};
}
