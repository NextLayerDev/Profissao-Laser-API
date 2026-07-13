import sharp from 'sharp';
import { generateToolImage } from './image-gen.js';

// ─────────────────────────────────────────────────────────────────────
// LINE-ART com IA: foto → gravura "nanquim vetorizado" (linhas limpas, hachuras
// nas sombras, fundo removido) via Gemini image (OpenRouter, reusa
// `generateToolImage`). É o único jeito de chegar no nível "print 2" — um
// algoritmo clássico não inventa detalhe de rosto nem limpa fundo poluído.
// Depois o Potrace vetoriza esse P&B limpo. Cobrada NA GERAÇÃO (IA custa).
// ─────────────────────────────────────────────────────────────────────

const NANQUIM_PROMPT = `PREMIUM BANKNOTE ENGRAVING FOR LASER

Transform this image into a premium, museum-quality black-and-white banknote engraving optimized for laser engraving and vector tracing. It must resemble the finest traditional steel-plate banknote engravings used on historical currency and security printing.

Do NOT create an illustration, a sketch, a painting, or an "AI art" style. The result must look ENGRAVED by a master banknote engraver.

STYLE: classic steel-plate engraving; traditional banknote / security-printing engraving; fine-line intaglio; guilloche-inspired texture; fine stippling; curved contour engraving; directional line engraving; high-detail monochrome portrait.

COLOR: pure black (#000000) and pure white (#FFFFFF) ONLY — binary. NO grayscale, NO transparency, NO blur, NO anti-aliasing, NO soft shadows, NO gradients.

BACKGROUND: remove everything — a perfectly clean, pure-white background. No scenery, no objects, no textures, no shadows, no frame or panel behind the subject. Only the subject, cut out by its own clean silhouette.

FACE (highest priority): preserve identity PERFECTLY — the person must be immediately recognizable. Preserve facial proportions and geometry, eyes, eyelashes, eyebrows, eyelids, nose, lips, smile, ears, jawline, cheekbones and skin texture. NEVER turn eyes or face parts into solid black blobs or empty holes.

SKIN: realistic engraved skin using fine stippling, very fine engraving lines, curved contour lines, directional engraving and natural tonal transitions. Avoid excessive darkness.

HAIR: preserve hairline, individual strands, flow direction, volume and texture, using curved engraving lines that follow the hair growth.

CLOTHING: preserve every visible fold, seam, collar and cuff, and any readable logos/text. Render fabric with engraved contour lines; different fabrics use different engraving densities.

HANDS: preserve anatomy, finger proportions and joints, and skin folds, with natural engraved shading.

TECHNIQUE: use ONLY fine engraving lines, curved contour hatching, directional hatching, contour-following engraving, fine stippling, cross-contour engraving and subtle very-fine parallel steel-plate linework. Every shadow must follow the object's three-dimensional shape.

CONTRAST: very high contrast, deep blacks, bright whites, strong readability — a luxury security-print appearance.

DETAIL: preserve every important detail — micro facial detail, hair detail, fabric detail, accessory detail, skin detail, fine wrinkles and fine contours.

FIDELITY: reproduce EXACTLY the same person, objects, pose, expression, composition and proportions of the input photo — only the STYLE changes. Do NOT add any text, watermark, border, frame, mockup or object that is not in the photo, and do NOT apply the art onto any surface or product.

FORBIDDEN: cartoon, comic, pencil sketch, watercolor, painting, digital illustration, rough/chaotic/messy crosshatching, artificial textures, large engraving strokes, random dots, noise, blur.

OUTPUT: an ultra-premium steel-plate, museum-quality banknote engraving — extremely detailed, clean pure-white background, high contrast, ~600 DPI appearance, laser-ready (Fiber Laser / LightBurn Trace / vector trace). Pure black and white only.`;

/**
 * Limpa a arte nanquim da IA: achata alpha em branco, converte p/ cinza e força
 * quase-branco → branco puro e quase-preto → preto puro. Sem isso, um fundo
 * levemente "sujo" (ex.: 240) faz o Potrace traçar o fundo inteiro. As hachuras
 * (tons médios) ficam intactas.
 */
async function cleanNanquim(buffer: Buffer): Promise<Buffer> {
	const { data, info } = await sharp(buffer, { failOn: 'none' })
		.flatten({ background: '#ffffff' })
		.grayscale()
		.toColourspace('b-w')
		.raw()
		.toBuffer({ resolveWithObject: true });
	for (let i = 0; i < data.length; i++) {
		if (data[i] >= 235) data[i] = 255;
		else if (data[i] <= 20) data[i] = 0;
	}
	return sharp(data, {
		raw: { width: info.width, height: info.height, channels: 1 },
	})
		.png()
		.toBuffer();
}

/**
 * Foto → PNG P&B limpo (nanquim) pronto p/ vetorizar. Reusa o cliente OpenRouter
 * do resto do sistema; lança em caso de falha (o controller estorna a cobrança).
 */
export async function redrawAsNanquim(
	photo: Buffer,
	signal?: AbortSignal,
): Promise<Buffer> {
	// Gemini funciona melhor com PNG; normaliza a entrada primeiro.
	const inputPng = await sharp(photo, { failOn: 'none' })
		.flatten({ background: '#ffffff' })
		.png()
		.toBuffer();
	const { png } = await generateToolImage(NANQUIM_PROMPT, [inputPng], signal);
	return cleanNanquim(png);
}

// ─────────────────────────────────────────────────────────────────────
// VETORIZAÇÃO COLORIDA com IA (Laser + UV): o motor de cor (k-means) sozinho
// achata gradientes e apaga texto/detalhe de renders/logos. A IA redesenha em
// VETOR DE CORES CHAPADAS FIEL (mesmas cores, logo e texto preservados, fundo
// removido) — aí o k-means traça um SVG colorido nítido em alta definição.
// ─────────────────────────────────────────────────────────────────────

const COLOR_VECTOR_PROMPT = `Redraw this image as a clean, professional FLAT-COLOR VECTOR ILLUSTRATION (mascot / sticker / logo style), optimized for vector tracing and printing.

FIDELITY (most important): reproduce EXACTLY the same subject, pose, composition, proportions and colors, and preserve EVERY detail — including all logos, symbols, icons and TEXT (reproduce any text legibly, letter by letter, keeping the same font look). Only the rendering STYLE changes (glossy 3D / photo → clean flat vector); the content and identity do NOT change. Do NOT add anything that is not in the image.

STYLE: crisp SOLID flat color areas with clean, smooth vector edges and clear separations between color regions. Convert glossy 3D gradients, reflections and highlights into a FEW clean flat tones of the SAME hue (e.g. one light and one dark shade) that keep the sense of shape and volume. Keep clean dark outlines/separations where they exist. Vibrant, saturated, faithful colors.

STRICTLY AVOID: photographic gradients, smooth shading, blur, noise, soft shadows, glossy reflections, 3D realism, texture. The result must look like a hand-made flat vector illustration with a limited, clean palette — ready to trace to SVG.

BACKGROUND: pure white (#FFFFFF), 100% clean and empty; the subject cut out by its own silhouette. No scenery, no shadow, no frame or panel.

Keep the palette faithful to the original (same colors). Sharp, high detail, print-ready flat vector art.`;

/**
 * Foto/imagem → PNG COLORIDO em estilo vetor de cores chapadas, pronto p/ o motor
 * de cor traçar em SVG nítido. Mantém a cor (sem P&B). Lança em caso de falha.
 */
export async function redrawAsColorVector(
	photo: Buffer,
	signal?: AbortSignal,
): Promise<Buffer> {
	const inputPng = await sharp(photo, { failOn: 'none' })
		.flatten({ background: '#ffffff' })
		.png()
		.toBuffer();
	const { png } = await generateToolImage(
		COLOR_VECTOR_PROMPT,
		[inputPng],
		signal,
	);
	// achata sobre branco (caso venha com alpha) — mantém as cores.
	return sharp(png, { failOn: 'none' })
		.flatten({ background: '#ffffff' })
		.png()
		.toBuffer();
}
