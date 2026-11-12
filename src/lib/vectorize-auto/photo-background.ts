/**
 * Fundo da fotogravação (model=laserphoto): segmentação do sujeito antes da IA,
 * máscara pela silhueta depois da limpeza nanquim e a heurística de "fundo
 * sujo" que dispara a nova tentativa da IA.
 *
 * Convenção das máscaras (a mesma de mask-ops.ts): 0 = sujeito, 255 = fundo.
 *
 * As funções sobre buffers crus (borderDarkFraction, applySubjectMask) são
 * puras e testadas sem rede; a segmentação real (onnx) fica atrás de um
 * parâmetro injetável para os testes não baixarem o modelo.
 */
import sharp from 'sharp';
import { buildAlphaMask } from './vector/color-quantize.js';
import {
	closeMask,
	dilateMask,
	fillInteriorHoles,
	maskCoverage,
} from './vector/mask-ops.js';

/**
 * Limiar do "fundo sujo": se mais de 35% dos pixels da faixa de borda (as 4
 * bordas somadas) forem escuros, a arte veio com quadrado/cenário de fundo.
 * 35% deixa passar o retrato normal cortado no peito (a borda de baixo inteira
 * escura é ~25% do perímetro de uma imagem quadrada) e pega o painel de fundo,
 * que escurece as 4 bordas ao mesmo tempo.
 */
export const BORDER_DIRTY_MAX_FRACTION = 0.35;
/** Cinza abaixo disso conta como pixel escuro (mesmo corte do potrace). */
export const BORDER_DARK_LEVEL = 128;
/** Largura (px) da faixa de borda analisada — 2px ignora 1px de serrilhado da IA. */
export const BORDER_BAND_PX = 2;

/** Alpha do RMBG acima disso = sujeito (mesmo corte do StickerAI/negativo). */
const ALPHA_THRESHOLD = 128;
/**
 * Corte do alpha na silhueta justa do motor local: o RMBG devolve cenário
 * duvidoso (bolo, vela, reflexo) meio transparente, e só o sujeito sai
 * firme. 128 deixava esse meio-tom virar sujeito.
 */
const TIGHT_ALPHA_THRESHOLD = 200;
/** Fecha vãos finos do alpha (fios de cabelo). */
const CLOSE_PX = 3;
/**
 * Folga da silhueta, como fração do maior lado: o nanquim desenha um contorno
 * POR FORA do sujeito e o alpha do RMBG costuma ficar 1-3px para dentro; sem a
 * folga a máscara come o contorno.
 */
const MASK_GROW_RATIO = 0.006;
/** Cobertura plausível da silhueta; fora disso a segmentação é lixo. */
const MIN_COVERAGE = 0.03;
const MAX_COVERAGE = 0.97;
/** Diferença de proporção tolerada entre a arte da IA e a máscara (10%). */
const ASPECT_TOLERANCE = 0.1;
/** Lado máximo da imagem enviada à segmentação (o RMBG trabalha em 1024). */
const SEGMENTATION_MAX_SIDE = 2048;

/**
 * Fração (0..1) de pixels escuros na faixa de `band` px das 4 bordas de uma
 * imagem em cinza 1 canal. Cada pixel da faixa conta uma vez (cantos inclusos).
 */
export function borderDarkFraction(
	gray: Uint8Array,
	width: number,
	height: number,
	band: number = BORDER_BAND_PX,
	darkLevel: number = BORDER_DARK_LEVEL,
): number {
	if (width <= 0 || height <= 0) return 0;
	const b = Math.max(
		1,
		Math.min(band, Math.floor(Math.min(width, height) / 2)),
	);
	let total = 0;
	let dark = 0;
	for (let y = 0; y < height; y++) {
		const edgeRow = y < b || y >= height - b;
		for (let x = 0; x < width; x++) {
			if (!edgeRow && x >= b && x < width - b) {
				// pula o miolo da linha
				x = width - b - 1;
				continue;
			}
			total++;
			if (gray[y * width + x] < darkLevel) dark++;
		}
	}
	return total === 0 ? 0 : dark / total;
}

export function isDirtyBackground(fraction: number): boolean {
	return fraction > BORDER_DIRTY_MAX_FRACTION;
}

/** Força branco (255) fora da silhueta. `mask`: 0 = sujeito. Não altera a entrada. */
export function applySubjectMask(gray: Uint8Array, mask: Uint8Array): Buffer {
	if (gray.length !== mask.length) {
		throw new Error(
			`applySubjectMask: tamanhos diferentes (${gray.length} vs ${mask.length}).`,
		);
	}
	const out = Buffer.from(gray);
	for (let i = 0; i < out.length; i++) {
		if (mask[i] !== 0) out[i] = 255;
	}
	return out;
}

/** Silhueta pronta para máscara: grade própria, 0 = sujeito. */
export interface SubjectMask {
	mask: Buffer;
	width: number;
	height: number;
	/** Sujeito recortado e composto sobre branco (PNG sRGB) — vai para a IA. */
	onWhitePng: Buffer;
	/** De onde veio a silhueta: 'alpha' = recorte do próprio upload (limpo, vale
	 *  como veio); 'segmentation' = RMBG da cena (pode trazer mancha de cenário).
	 *  Ausente = tratar como segmentação. */
	source?: 'alpha' | 'segmentation';
}

/** Folga (px) que `subjectMaskFromCutout` soma à silhueta numa grade W×H. */
export function maskSlackPx(width: number, height: number): number {
	return Math.max(2, Math.round(Math.max(width, height) * MASK_GROW_RATIO));
}

/**
 * Converte o PNG RGBA da segmentação em máscara binária (0 = sujeito), com folga.
 * `fillHoles: false` mantém os vãos fechados do recorte (entre braço e corpo,
 * mão na cintura): no alpha do upload eles são fundo de verdade; no RMBG
 * costumam ser interior claro que o modelo perdeu.
 */
export async function subjectMaskFromCutout(
	cutoutPng: Buffer,
	opts: { fillHoles?: boolean; tight?: boolean } = {},
): Promise<{ mask: Buffer; width: number; height: number }> {
	const { data, info } = await sharp(cutoutPng, { failOn: 'none' })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const W = info.width;
	const H = info.height;
	const threshold = opts.tight ? TIGHT_ALPHA_THRESHOLD : ALPHA_THRESHOLD;
	let mask = closeMask(buildAlphaMask(data, threshold, W, H), W, H, CLOSE_PX);
	if (opts.fillHoles !== false) mask = fillInteriorHoles(mask, W, H);
	// A folga existe para o contorno que a IA desenha por fora do sujeito; o
	// motor local desenha o próprio contorno sobre a borda, e a folga só traria
	// uma faixa de cenário (e engrossaria o risco grudado na orelha, que aí
	// sobrevivia à abertura).
	if (!opts.tight) mask = dilateMask(mask, W, H, maskSlackPx(W, H));
	return { mask, width: W, height: H };
}

/** Fração mínima de pixels transparentes para o alpha do upload contar como recorte. */
const MIN_TRANSPARENT_FRACTION = 0.01;

/**
 * Silhueta a partir do alpha do PRÓPRIO upload — o cliente (grava_ai) já manda
 * a foto recortada em PNG transparente. Devolve null quando não há alpha de
 * verdade (sem canal, opaco, ou cobertura implausível). NUNCA lança.
 */
export async function subjectFromAlpha(
	imageBuffer: Buffer,
): Promise<SubjectMask | null> {
	try {
		const img = sharp(imageBuffer, { failOn: 'none' }).rotate();
		const meta = await img.metadata();
		if (!meta.hasAlpha) return null;
		const png = await img
			.resize(SEGMENTATION_MAX_SIDE, SEGMENTATION_MAX_SIDE, {
				fit: 'inside',
				withoutEnlargement: true,
			})
			.png()
			.toBuffer();
		const { data, info } = await sharp(png)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		let transparent = 0;
		for (let i = 3; i < data.length; i += 4)
			if (data[i] < ALPHA_THRESHOLD) transparent++;
		if (transparent / (info.width * info.height) < MIN_TRANSPARENT_FRACTION)
			return null;

		const { mask, width, height } = await subjectMaskFromCutout(png, {
			fillHoles: false,
		});
		const coverage = maskCoverage(mask);
		if (coverage < MIN_COVERAGE || coverage > MAX_COVERAGE) return null;
		const onWhitePng = await sharp(png)
			.flatten({ background: '#ffffff' })
			.toColourspace('srgb')
			.png()
			.toBuffer();
		return { mask, width, height, onWhitePng, source: 'alpha' };
	} catch (err) {
		console.error('[photo-background] alpha do upload ilegível:', err);
		return null;
	}
}

/**
 * Silhueta a partir da máscara que o cliente corrigiu no editor de recorte
 * (PNG em cinza, branco = sujeito, na grade que `subjectMaskPng` devolveu).
 * Vale como veio — sem folga nem limpeza. Devolve null se ilegível ou vazia.
 */
export async function subjectFromMaskPng(
	photo: Buffer,
	maskPng: Buffer,
): Promise<SubjectMask | null> {
	try {
		const { data: m, info } = await sharp(maskPng, { failOn: 'none' })
			.flatten({ background: '#000000' })
			.extractChannel(0)
			.raw()
			.toBuffer({ resolveWithObject: true });
		const width = info.width;
		const height = info.height;
		const mask = Buffer.alloc(width * height);
		const alpha = Buffer.alloc(width * height);
		for (let i = 0; i < mask.length; i++) {
			const on = m[i] >= 128;
			mask[i] = on ? 0 : 255;
			alpha[i] = on ? 255 : 0;
		}
		const coverage = maskCoverage(mask);
		if (coverage <= 0 || coverage >= 1) return null;
		const rgb = await sharp(photo, { failOn: 'none' })
			.rotate()
			.flatten({ background: '#ffffff' })
			.resize(width, height, { fit: 'fill' })
			.removeAlpha()
			.toColourspace('srgb')
			.raw()
			.toBuffer();
		const cut = await sharp(rgb, { raw: { width, height, channels: 3 } })
			.joinChannel(alpha, { raw: { width, height, channels: 1 } })
			.png()
			.toBuffer();
		const onWhitePng = await sharp(cut)
			.flatten({ background: '#ffffff' })
			.toColourspace('srgb')
			.png()
			.toBuffer();
		return { mask, width, height, onWhitePng, source: 'alpha' };
	} catch (err) {
		console.error('[photo-background] máscara do editor ilegível:', err);
		return null;
	}
}

/** Silhueta em PNG cinza (branco = sujeito) — o que o editor de recorte abre. */
export async function subjectMaskPng(
	subject: Pick<SubjectMask, 'mask' | 'width' | 'height'>,
): Promise<Buffer> {
	const out = Buffer.alloc(subject.mask.length);
	for (let i = 0; i < out.length; i++) out[i] = subject.mask[i] === 0 ? 255 : 0;
	return sharp(out, {
		raw: { width: subject.width, height: subject.height, channels: 1 },
	})
		.png({ compressionLevel: 9 })
		.toBuffer();
}

export type Segmenter = (png: Buffer) => Promise<Buffer>;

/**
 * Segmenta o sujeito da foto. NUNCA lança: qualquer falha (onnx indisponível,
 * download do modelo, silhueta implausível) devolve null e o pedido segue sem
 * remoção de fundo (`background_removed: false`).
 *
 * Custo: no cold start o onnxruntime carrega e baixa o RMBG-1.4 small (~44MB)
 * do CDN — ~5-20 s; aquecido, a inferência leva ~1-3 s numa foto de 1024px.
 */
export async function trySegmentSubject(
	imageBuffer: Buffer,
	segmenter?: Segmenter,
	opts: { tight?: boolean } = {},
): Promise<SubjectMask | null> {
	try {
		const work = await sharp(imageBuffer, { failOn: 'none' })
			.rotate()
			.flatten({ background: '#ffffff' })
			.resize(SEGMENTATION_MAX_SIDE, SEGMENTATION_MAX_SIDE, {
				fit: 'inside',
				withoutEnlargement: true,
			})
			.toColourspace('srgb')
			.png()
			.toBuffer();

		const segment: Segmenter =
			segmenter ??
			(async (png) =>
				(await import('./segmentation.js')).segmentSubjectPng(png));
		const cutout = await segment(work);

		const { mask, width, height } = await subjectMaskFromCutout(cutout, {
			tight: opts.tight,
		});
		const coverage = maskCoverage(mask);
		if (coverage < MIN_COVERAGE || coverage > MAX_COVERAGE) {
			console.warn(
				`[photo-background] silhueta implausível (cobertura ${coverage.toFixed(3)}) — seguindo sem remover o fundo`,
			);
			return null;
		}

		const onWhitePng = await sharp(cutout, { failOn: 'none' })
			.flatten({ background: '#ffffff' })
			.toColourspace('srgb')
			.png()
			.toBuffer();
		return { mask, width, height, onWhitePng, source: 'segmentation' };
	} catch (err) {
		console.error(
			'[photo-background] segmentação indisponível, seguindo sem remover o fundo:',
			err,
		);
		return null;
	}
}

/**
 * Upload com alpha achatado sobre branco (PNG sRGB) — o que vai para a IA
 * quando não há recorte pronto. O RGB das áreas transparentes do recorte do
 * grava_ai é verde de chroma: mandado cru, a IA via o verde e desenhava em
 * cima dele. Sem alpha devolve o próprio buffer (o pedido fica como antes).
 */
export async function flattenOnWhite(imageBuffer: Buffer): Promise<Buffer> {
	try {
		const img = sharp(imageBuffer, { failOn: 'none' });
		if (!(await img.metadata()).hasAlpha) return imageBuffer;
		return await img
			.rotate()
			.flatten({ background: '#ffffff' })
			.toColourspace('srgb')
			.png()
			.toBuffer();
	} catch {
		return imageBuffer;
	}
}

/**
 * Aplica a silhueta à arte nanquim já limpa (PNG em cinza): tudo fora do
 * sujeito vira branco puro, então não sobra quadrado de fundo para o motor
 * pontilhar. A máscara é reamostrada para a grade da arte (ver
 * resizeSubjectMask). Devolve null quando a IA mudou a proporção da imagem além
 * da tolerância — aí a máscara não alinharia e é melhor não aplicar.
 */
export async function maskArtWithSubject(
	artPng: Buffer,
	subject: Pick<SubjectMask, 'mask' | 'width' | 'height'>,
): Promise<Buffer | null> {
	const { data: gray, info } = await sharp(artPng, { failOn: 'none' })
		.flatten({ background: '#ffffff' })
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const W = info.width;
	const H = info.height;

	const resized = await resizeSubjectMask(subject, W, H);
	if (!resized) return null;

	const masked = applySubjectMask(gray, resized);
	return sharp(masked, { raw: { width: W, height: H, channels: 1 } })
		.png()
		.toBuffer();
}

/**
 * Reamostra a silhueta para a grade W×H da arte: interpolação linear e corte de
 * novo em 128. O vizinho mais próximo deixava a borda em degrau (cada pixel da
 * máscara virava um bloco), e no copo escuro o degrau sai gravado. Null quando
 * a proporção diverge além da tolerância — a IA mudou o enquadramento e a
 * máscara não alinharia.
 */
export async function resizeSubjectMask(
	subject: Pick<SubjectMask, 'mask' | 'width' | 'height'>,
	W: number,
	H: number,
): Promise<Buffer | null> {
	const artAspect = W / H;
	const maskAspect = subject.width / subject.height;
	if (Math.abs(artAspect - maskAspect) / maskAspect > ASPECT_TOLERANCE) {
		console.warn(
			`[photo-background] proporção da arte (${W}x${H}) diverge da máscara (${subject.width}x${subject.height}) — máscara não aplicada`,
		);
		return null;
	}
	if (subject.width === W && subject.height === H) return subject.mask;
	const smooth = await sharp(subject.mask, {
		raw: { width: subject.width, height: subject.height, channels: 1 },
	})
		.resize(W, H, { fit: 'fill', kernel: 'linear' })
		// sharp devolve 3 canais por padrão; a máscara é 1 canal.
		.extractChannel(0)
		.raw()
		.toBuffer();
	for (let i = 0; i < smooth.length; i++) smooth[i] = smooth[i] < 128 ? 0 : 255;
	return smooth;
}

/** Fração de borda escura de um PNG (decodifica em cinza). */
export async function borderDarkFractionOfPng(png: Buffer): Promise<number> {
	const { data, info } = await sharp(png, { failOn: 'none' })
		.flatten({ background: '#ffffff' })
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return borderDarkFraction(data, info.width, info.height);
}
