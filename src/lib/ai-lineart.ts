import sharp from 'sharp';
import { type VerifyReason, verifyStructure } from './ai-verify.js';
import { generateToolImage } from './image-gen.js';

// ─────────────────────────────────────────────────────────────────────
// REDESENHO com IA pra vetorização. Dois prompts, escolhidos pelo tipo de
// imagem (ver `image-classify.ts` — decisão server-side, invisível na UI):
//
//   FOTO → gravura "nanquim" (linhas limpas, hachuras nas sombras, fundo
//          removido). É o único jeito de chegar no nível "print 2": um
//          algoritmo clássico não inventa detalhe de rosto nem limpa fundo.
//   LOGO → redesenho vetorial FIEL em P&B (mesmas formas, mesmas letras).
//
// Mandar logo no prompt de foto era o bug que fazia um logo virar 4 retratos
// em grade: o prompt de nanquim pede literalmente uma gravura de cédula com
// rosto, pele e cabelo.
//
// Toda saída passa por `verifyStructure` (só sharp, sem custo). Falhou →
// 1 retry com prompt mais rígido → falhou de novo → devolve `png: null` e o
// controller estorna e cai na vetorização normal, que nunca alucina.
// Cobrada NA GERAÇÃO (IA custa).
// ─────────────────────────────────────────────────────────────────────

export type NanquimSubject = 'photo' | 'logo';

export interface RedrawOutcome {
	/** null → verificação estrutural falhou nas 2 tentativas. NÃO é erro. */
	png: Buffer | null;
	attempts: number;
	failures: VerifyReason[];
}

/**
 * System prompt de FIDELIDADE pra vetorização. Substitui o
 * `DEFAULT_IMAGE_SYSTEM_PROMPT` (o `buildImageSystemPrompt` faz replace, não
 * concat) — por isso carrega também a espinha de aderência.
 *
 * O default genérico diz "as imagens de referência servem APENAS como
 * referência de assunto/estilo; o texto prevalece sobre qualquer referência".
 * Isso está ATIVAMENTE ERRADO aqui: na vetorização a referência É o conteúdo a
 * reproduzir, e aquela linha autoriza o modelo a se afastar da arte. Aqui a
 * relação é invertida: a referência define O QUE, o texto define COMO.
 */
export const VECTORIZE_FIDELITY_SYSTEM = [
	'Você é um motor de redesenho de alta fidelidade para gravação a laser.',
	'Você NUNCA inventa conteúdo. Seu único trabalho é re-desenhar a arte que está na imagem de referência, no estilo descrito pelo texto.',
	'A IMAGEM DE REFERÊNCIA define O QUE é desenhado. O TEXTO define COMO é desenhado. Nenhum dos dois pode ser ignorado.',
	'Siga as instruções do texto EXATAMENTE, palavra por palavra. Toda restrição explícita (cores, fundo, enquadramento, técnica de traço, densidade, composição) é OBRIGATÓRIA.',
	'Gere EXATAMENTE UMA arte, em UM único quadro. Nunca grade, contact sheet, colagem, painéis, variações ou o mesmo assunto repetido.',
	'Reproduza o conteúdo da referência EXATAMENTE: mesmo assunto, mesma quantidade de elementos, mesma pose, mesma composição, mesmas proporções, mesmo enquadramento e mesmo recorte. Só o estilo de renderização muda.',
	'Não acrescente nada que não esteja na referência e não remova nada que esteja. Não "melhore", não corrija, não reinterprete.',
	'Se houver texto na referência, copie-o letra por letra, com o mesmo desenho de letra. Nunca invente, traduza, corrija nem complete texto.',
	"Responda apenas com a imagem. Sem explicação, sem legenda, sem marca d'água.",
].join(' ');

/**
 * Trava de ARTE ÚNICA — anexada aos DOIS prompts. É a única coisa que faltava
 * em ambos: nem o prompt de nanquim nem o de logo proibiam múltiplos painéis, e
 * o modelo respondia com uma grade de variações (a falha reportada).
 */
const ARTE_UNICA = `ARTE ÚNICA (regra absoluta): gere EXATAMENTE UMA imagem, em UM único quadro, preenchendo o quadro como a referência preenche. NUNCA produza grade, contact sheet, colagem, mosaico, painéis, lado a lado, antes/depois, múltiplas versões, múltiplas variações, múltiplos enquadramentos, nem o mesmo assunto repetido 2, 3 ou 4 vezes. Se sentir vontade de mostrar opções, não mostre: escolha uma e entregue só ela.`;

const NANQUIM_PROMPT = `PREMIUM BANKNOTE ENGRAVING FOR LASER

Transform this image into a premium, museum-quality black-and-white banknote engraving optimized for laser engraving and vector tracing. It must resemble the finest traditional steel-plate banknote engravings used on historical currency and security printing.

Do NOT create an illustration, a sketch, a painting, or an "AI art" style. The result must look ENGRAVED by a master banknote engraver.

STYLE: classic steel-plate engraving; traditional banknote / security-printing engraving; fine-line intaglio; guilloche-inspired texture; fine stippling; curved contour engraving; directional line engraving; high-detail monochrome portrait.

COLOR: pure black (#000000) and pure white (#FFFFFF) ONLY — binary. NO grayscale, NO transparency, NO blur, NO anti-aliasing, NO soft shadows, NO gradients.

BACKGROUND: remove everything — a perfectly clean, pure-white background. No scenery, no objects, no textures, no shadows, no frame or panel behind the subject. Only the subject, cut out by its own clean silhouette.

FRAMING (critical): keep the ENTIRE subject inside the frame, with a clear white margin on all four sides. NEVER let the subject, its clothing, its hair or its shading touch, run off, or be cropped by the edge of the image. If the reference photo is cut off at the torso, close the silhouette there with a clean continuous outline instead of running the artwork off the edge — the engraving must read as a cut-out figure floating on white, never as a picture that fills the frame. THE FOUR CORNERS OF THE IMAGE MUST BE PURE WHITE. Never draw a rectangle, square, box or block of engraving in a corner or along an edge.

FACE (highest priority, when the image contains a face): preserve identity PERFECTLY — the person must be immediately recognizable. Preserve facial proportions and geometry, eyes, eyelashes, eyebrows, eyelids, nose, lips, smile, ears, jawline, cheekbones and skin texture. NEVER turn eyes or face parts into solid black blobs or empty holes.

SKIN (when present): realistic engraved skin using fine stippling, very fine engraving lines, curved contour lines, directional engraving and natural tonal transitions. Avoid excessive darkness.

HAIR (when present): preserve hairline, individual strands, flow direction, volume and texture, using curved engraving lines that follow the hair growth.

CLOTHING (when present): preserve every visible fold, seam, collar and cuff, and any readable logos/text. Render fabric with engraved contour lines; different fabrics use different engraving densities.

HANDS (when present): preserve anatomy, finger proportions and joints, and skin folds, with natural engraved shading.

TECHNIQUE: use ONLY fine engraving lines, curved contour hatching, directional hatching, contour-following engraving, fine stippling, cross-contour engraving and subtle very-fine parallel steel-plate linework. Every shadow must follow the object's three-dimensional shape.

CONTRAST: very high contrast, deep blacks, bright whites, strong readability — a luxury security-print appearance.

DETAIL: preserve every important detail — micro facial detail, hair detail, fabric detail, accessory detail, skin detail, fine wrinkles and fine contours.

NO HOLES, NO BLOWN-OUT AREAS (critical): every part of the subject must carry engraving. NEVER leave an empty white patch, blank blob, missing chunk or unfinished area anywhere inside the subject — not on the face, not on the hair, not on the ears, not on clothing, not on hands. Light areas are rendered with SPARSE fine lines or stippling, never with blank white. Dark areas are rendered with DENSE hatching, never with a flat solid black mass that swallows the detail underneath. Every region must read as deliberately engraved, with the whole silhouette filled edge to edge by linework.

FIDELITY: reproduce EXACTLY the same person, objects, pose, expression, composition and proportions of the input photo — only the STYLE changes. Do NOT add any text, watermark, border, frame, mockup or object that is not in the photo, and do NOT apply the art onto any surface or product.

FORBIDDEN: cartoon, comic, pencil sketch, watercolor, painting, digital illustration, rough/chaotic/messy crosshatching, artificial textures, large engraving strokes, random dots, noise, blur.

OUTPUT: an ultra-premium steel-plate, museum-quality banknote engraving — extremely detailed, clean pure-white background, high contrast, ~600 DPI appearance, laser-ready (Fiber Laser / LightBurn Trace / vector trace). Pure black and white only.

${ARTE_UNICA}`;

/**
 * Prompt de LOGO, customizado a pedido. A única instrução não óbvia lendo o
 * texto puro: figuras humanas dentro do logo viram SILHUETA preta detalhada
 * (não contorno/linha), com anatomia clara — diferente do resto do prompt,
 * que é fidelidade 1:1 de forma/cor.
 */
const LOGO_PROMPT = `Converter a imagem fornecida em uma arte vetorial profissional em preto e branco.
Remover completamente todas as cores, mantendo apenas preto puro (#000000) para áreas sólidas e branco puro (#FFFFFF) como fundo.
Preservar todos os elementos da composição original: figuras humanas, símbolos, tipografia, estrelas, faixas e formas geométricas.
As figuras humanas devem ser transformadas em silhuetas pretas detalhadas, com contornos bem definidos e anatomia clara.
Textos devem ser vetorizados com bordas nítidas e leitura perfeita.
Não utilizar gradientes, sombras, bitmap, tons de cinza ou efeitos rasterizados.
Todos os caminhos devem ser fechados, contínuos e limpos, prontos para gravação ou corte a laser.
Estilo final: arte vetorial técnica, alto contraste, acabamento profissional.

${ARTE_UNICA}`;

const COLOR_VECTOR_PROMPT = `Redraw this image as a clean, professional FLAT-COLOR VECTOR ILLUSTRATION (mascot / sticker / logo style), optimized for vector tracing and printing.

FIDELITY (most important): reproduce EXACTLY the same subject, pose, composition, proportions and colors, and preserve EVERY detail — including all logos, symbols, icons and TEXT (reproduce any text legibly, letter by letter, keeping the same font look). Only the rendering STYLE changes (glossy 3D / photo → clean flat vector); the content and identity do NOT change. Do NOT add anything that is not in the image.

STYLE: crisp SOLID flat color areas with clean, smooth vector edges and clear separations between color regions. Convert glossy 3D gradients, reflections and highlights into a FEW clean flat tones of the SAME hue (e.g. one light and one dark shade) that keep the sense of shape and volume. Keep clean dark outlines/separations where they exist. Vibrant, saturated, faithful colors.

STRICTLY AVOID: photographic gradients, smooth shading, blur, noise, soft shadows, glossy reflections, 3D realism, texture. The result must look like a hand-made flat vector illustration with a limited, clean palette — ready to trace to SVG.

BACKGROUND: pure white (#FFFFFF), 100% clean and empty; the subject cut out by its own silhouette. No scenery, no shadow, no frame or panel.

Keep the palette faithful to the original (same colors). Sharp, high detail, print-ready flat vector art.

${ARTE_UNICA}`;

const RETRY_HINTS: Record<VerifyReason, string> = {
	tiled_output:
		'Você produziu MÚLTIPLAS cópias, painéis ou uma grade de imagens. Gere EXATAMENTE UMA arte, em UM quadro, ocupando a imagem inteira — sem grade, sem painéis, sem variações, sem repetir o assunto.',
	layout_mismatch:
		'Sua saída não bateu com o layout da referência: as formas estão em lugares errados. Mantenha CADA elemento na MESMA posição, no MESMO tamanho, com o MESMO enquadramento e recorte da referência.',
	blank_output:
		'Sua saída ficou quase toda branca/vazia. Desenhe o assunto real da referência, em preto sólido sobre branco.',
	black_output:
		'Sua saída ficou quase toda preta. Use branco no fundo e nas áreas claras; use preto só nas linhas e nas áreas escuras de verdade.',
	aspect_changed:
		'Sua saída mudou a proporção / o recorte. Mantenha a MESMA proporção e o MESMO enquadramento da imagem de referência.',
};

function stricterPrompt(base: string, reasons: VerifyReason[]): string {
	const hints = reasons.map((r) => `- ${RETRY_HINTS[r]}`).join('\n');
	return `${base}

── RETRY — A TENTATIVA ANTERIOR FOI REJEITADA ──
Uma verificação estrutural automática rejeitou sua saída anterior.
${hints}
Corrija agora. Releia a imagem de referência e reproduza O CONTEÚDO e O LAYOUT dela exatamente. Não tente nada criativo. Na dúvida, copie a referência mais literalmente.`;
}

/**
 * Limpa a arte nanquim da IA: achata alpha em branco, converte p/ cinza e força
 * quase-branco → branco puro e quase-preto → preto puro. Sem isso, um fundo
 * levemente "sujo" (ex.: 240) faz o Potrace traçar o fundo inteiro. As hachuras
 * (tons médios) ficam intactas.
 *
 * NÃO tentar "limpar o fundo" com flood-fill a partir das bordas: numa gravura
 * hachurada o fundo está conectado às frestas claras ENTRE as linhas por toda a
 * figura, então a inundação permeia o desenho inteiro e apaga os meios-tons do
 * sombreado. Medido: alcançava 92% da imagem e alterava 4,5% do miolo, abrindo
 * buracos brancos dentro da arte.
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

/** Gemini funciona melhor com PNG; normaliza a entrada primeiro. */
async function toInputPng(photo: Buffer): Promise<Buffer> {
	return sharp(photo, { failOn: 'none' })
		.flatten({ background: '#ffffff' })
		.png()
		.toBuffer();
}

function gcd(a: number, b: number): number {
	return b === 0 ? a : gcd(b, a % b);
}

/**
 * Trava NUMÉRICA de proporção, anexada ao prompt.
 *
 * Medido: entrada 1:1 devolvida como 1.8333:1 em três gerações seguidas, sempre
 * o mesmo valor — o modelo escolhe o formato dele e o retry com prompt
 * qualitativo ("mantenha o mesmo enquadramento") não muda nada. Dizer a razão
 * em número é a única instrução concreta.
 *
 * NÃO usamos o `width`/`height` do `generateToolImage`: além do texto, ele força
 * `resize(fit:'fill')` no fim — e como o modelo desobedece, isso ESMAGARIA o
 * rosto para caber. Aqui só instruímos; quem corrige de fato é o letterbox.
 */
function aspectLock(w: number, h: number): string {
	const g = gcd(w, h) || 1;
	const ratio = `${Math.round(w / g)}:${Math.round(h / g)}`;
	const orient =
		w > h ? 'horizontal (paisagem)' : w < h ? 'vertical (retrato)' : 'quadrada';
	return `PROPORÇÃO OBRIGATÓRIA: a saída deve ter EXATAMENTE a mesma proporção da imagem de referência — ${ratio}, orientação ${orient} (${w}×${h} px). NÃO mude para widescreen, NÃO mude para quadrado, NÃO recorte e NÃO estenda a cena para preencher outro formato. O formato da tela é o mesmo da referência.`;
}

/**
 * Completa a saída com margem branca até a proporção da entrada.
 *
 * Só ACRESCENTA moldura — nunca corta arte nem distorce. É a correção certa
 * quando o único defeito é o enquadramento: evita gastar uma segunda geração
 * (que, medido, devolve exatamente a mesma proporção errada).
 */
async function letterboxToAspect(
	png: Buffer,
	targetAspect: number,
): Promise<Buffer> {
	const meta = await sharp(png).metadata();
	const w = meta.width ?? 0;
	const h = meta.height ?? 0;
	if (!w || !h || targetAspect <= 0) return png;
	const current = w / h;
	const bg = { r: 255, g: 255, b: 255, alpha: 1 };
	if (current > targetAspect) {
		const pad = Math.round(w / targetAspect) - h;
		if (pad <= 0) return png;
		return sharp(png)
			.extend({
				top: Math.floor(pad / 2),
				bottom: Math.ceil(pad / 2),
				background: bg,
			})
			.png()
			.toBuffer();
	}
	const pad = Math.round(h * targetAspect) - w;
	if (pad <= 0) return png;
	return sharp(png)
		.extend({
			left: Math.floor(pad / 2),
			right: Math.ceil(pad / 2),
			background: bg,
		})
		.png()
		.toBuffer();
}

/**
 * Gera → verifica → (se falhou) regera com prompt mais rígido → verifica.
 * Devolve `png: null` quando as duas tentativas falharam na verificação.
 *
 * Devolver null em vez de lançar é deliberado: um throw cairia no catch-all do
 * controller, que estorna E devolve 5xx. Aqui queremos estornar E devolver 201
 * com um resultado usável (a vetorização normal).
 */
async function generateVerified(
	basePrompt: string,
	inputPng: Buffer,
	post: (png: Buffer) => Promise<Buffer>,
	signal?: AbortSignal,
): Promise<RedrawOutcome> {
	let failures: VerifyReason[] = [];

	const meta = await sharp(inputPng).metadata();
	const inW = meta.width ?? 0;
	const inH = meta.height ?? 0;
	const inAspect = inW && inH ? inW / inH : 0;
	const promptWithAspect = inAspect
		? `${basePrompt}\n\n${aspectLock(inW, inH)}`
		: basePrompt;

	for (let attempt = 1; attempt <= 2; attempt++) {
		const prompt =
			attempt === 1
				? promptWithAspect
				: stricterPrompt(promptWithAspect, failures);
		// Um throw aqui é falha de infra (sem chave, timeout, erro do provedor),
		// não de fidelidade — propaga pro controller estornar e responder erro.
		let { png } = await generateToolImage(prompt, [inputPng], signal, {
			systemPromptOverride: VECTORIZE_FIDELITY_SYSTEM,
		});

		let verdict = await verifyStructure(inputPng, png);

		// Enquadramento é o ÚNICO defeito → corrige em vez de gastar outra
		// geração. O letterbox só acrescenta margem branca, então não pode
		// introduzir nenhuma das outras falhas que já passaram.
		if (
			!verdict.ok &&
			inAspect &&
			verdict.reasons.length === 1 &&
			verdict.reasons[0] === 'aspect_changed'
		) {
			png = await letterboxToAspect(png, inAspect);
			if (process.env.DEBUG_IMAGE_GEN) {
				console.debug('[ai-lineart] proporção corrigida por letterbox', {
					attempt,
					de: verdict.metrics.arOut.toFixed(3),
					para: inAspect.toFixed(3),
				});
			}
			verdict = { ...verdict, ok: true, reasons: [] };
		}

		if (verdict.ok) {
			// Loga o SUCESSO também: sem isto, silêncio no log é ambíguo entre
			// "passou na verificação" e "ainda rodando".
			if (process.env.DEBUG_IMAGE_GEN) {
				console.debug('[ai-lineart] verificação OK', {
					attempt,
					corr: verdict.metrics.corr.toFixed(3),
					occOut: verdict.metrics.occOut.toFixed(3),
				});
			}
			return { png: await post(png), attempts: attempt, failures: [] };
		}
		failures = verdict.reasons;
		if (process.env.DEBUG_IMAGE_GEN) {
			console.debug('[ai-lineart] verificação rejeitou a saída', {
				attempt,
				reasons: verdict.reasons,
				metrics: verdict.metrics,
			});
		}
	}

	return { png: null, attempts: 2, failures };
}

/**
 * Foto/logo → PNG P&B limpo pronto p/ vetorizar. O `subject` escolhe o prompt
 * (ver `classifyImage`). Reusa o cliente OpenRouter do resto do sistema.
 */
export async function redrawAsNanquim(
	photo: Buffer,
	subject: NanquimSubject,
	signal?: AbortSignal,
): Promise<RedrawOutcome> {
	const inputPng = await toInputPng(photo);
	const prompt = subject === 'logo' ? LOGO_PROMPT : NANQUIM_PROMPT;
	return generateVerified(prompt, inputPng, cleanNanquim, signal);
}

/**
 * Foto/imagem → PNG COLORIDO em estilo vetor de cores chapadas, pronto p/ o
 * motor de cor traçar em SVG nítido. Mantém a cor (sem P&B).
 */
export async function redrawAsColorVector(
	photo: Buffer,
	signal?: AbortSignal,
): Promise<RedrawOutcome> {
	const inputPng = await toInputPng(photo);
	// achata sobre branco (caso venha com alpha) — mantém as cores.
	const post = (png: Buffer) =>
		sharp(png, { failOn: 'none' })
			.flatten({ background: '#ffffff' })
			.png()
			.toBuffer();
	return generateVerified(COLOR_VECTOR_PROMPT, inputPng, post, signal);
}
