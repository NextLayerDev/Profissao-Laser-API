import sharp from 'sharp';
import { z } from 'zod';
import { ToolEngineError } from '../../lib/tool-errors.js';
import type { ToolBlock } from '../types.js';

/**
 * `image.make_tileable` — transforma uma imagem qualquer numa TEXTURA QUE SE
 * REPETE sem costura visível. 100% sharp, zero dependência nova, zero IA.
 *
 * POR QUE ISTO EXISTE EM CÓDIGO E NÃO NO PROMPT: modelo de imagem NÃO gera
 * tileável de verdade. Ele entende o pedido, produz algo bonito, e as bordas
 * não fecham — repetir a imagem revela uma grade de emendas. Prometer
 * "textura sem emenda" via prompt é vender defeito. O algoritmo abaixo é
 * determinístico: a borda esquerda passa a casar com a direita POR
 * CONSTRUÇÃO, independentemente do que o modelo desenhou.
 *
 * O algoritmo (offset + mirror blend), em três atos:
 *
 *   1. OFFSET de 50%/50% com wrap (4 extract + 1 composite). Trocar os quatro
 *      quadrantes em diagonal traz as bordas originais para o MEIO da imagem.
 *      O efeito colateral é o ponto inteiro da técnica: as novas bordas eram,
 *      no original, duas colunas VIZINHAS (a do meio e a anterior) — ou seja,
 *      já casam perfeitamente. O problema deixa de ser "fechar a borda" e
 *      passa a ser "disfarçar uma emenda no meio", que é resolvível.
 *
 *   2. MÁSCARA de gradiente linear numa faixa de 12% do lado, EM CRUZ sobre as
 *      duas emendas (a vertical e a horizontal).
 *
 *   3. COMPOSIÇÃO da versão espelhada (flop no eixo X, flip no Y) por cima,
 *      com essa máscara. O espelhamento é escolhido de propósito: com a
 *      máscara valendo 0,5 exatamente na emenda, os dois lados recebem a MESMA
 *      média dos pixels vizinhos — o degrau some por matemática, não por sorte.
 *      Fora da faixa a máscara é 0 e a imagem original fica intacta.
 *
 * ONDE FUNCIONA BEM: textura ORGÂNICA — madeira, pedra, couro, tecido, concreto.
 * Que é exatamente o caso de fundo/preenchimento em gravação a laser.
 * ONDE FUNCIONA MAL: padrão geométrico regular (xadrez, tijolo alinhado, listra),
 * onde o espelhamento quebra a cadência e o olho acha a emenda mesmo sem degrau
 * de cor. Por isso a tela mostra um preview 3×3 e deixa a pessoa julgar, em vez
 * de prometer perfeição — a UI repete o PNG com `background-repeat` (custo zero;
 * gerar o 3×3 aqui só desperdiçaria banda).
 */

/**
 * Teto de pixels. O blend faz uma passada RGBA em JS (width×height×4), então
 * uma entrada gigante viraria centenas de MB de buffer. 40 MP cobre qualquer
 * saída do Estúdio (a maior é 1536×1536 ≈ 2,4 MP) com folga de sobra.
 */
const MAX_TILE_PIXELS = 40 * 1_000_000;

/** Faixa de blend padrão: 12% do lado. */
export const DEFAULT_BAND_PCT = 0.12;

/**
 * Máscara de alfa (1 canal, raw) com um "telhado" linear centrado na emenda:
 * 0,5 no vinco e caindo até 0 na borda da faixa.
 *
 * O PICO É 0,5, NÃO 1 — e isso é o coração do truque. Na emenda, a imagem
 * espelhada contém justamente o pixel do OUTRO lado do vinco; misturar meio a
 * meio dá a mesma média nos dois lados, e o degrau desaparece. Um pico 1
 * substituiria um lado pelo outro e só mudaria o degrau de lugar.
 */
export function seamBandMask(
	width: number,
	height: number,
	axis: 'x' | 'y',
	/** Posição da emenda (fronteira entre as colunas/linhas `seam-1` e `seam`). */
	seam: number,
	/** Largura total da faixa de transição, em px. */
	band: number,
): Buffer {
	const mask = Buffer.alloc(width * height);
	const half = Math.max(1, band / 2);
	const alphaAt = (i: number) => {
		// `i + 0.5` = centro do pixel: a emenda é a FRONTEIRA entre dois pixels,
		// então medir do centro deixa o perfil simétrico dos dois lados dela.
		const d = Math.abs(i + 0.5 - seam);
		if (d >= half) return 0;
		return Math.round(0.5 * (1 - d / half) * 255);
	};

	if (axis === 'x') {
		const row = Buffer.alloc(width);
		for (let x = 0; x < width; x++) row[x] = alphaAt(x);
		for (let y = 0; y < height; y++) row.copy(mask, y * width);
	} else {
		for (let y = 0; y < height; y++) {
			mask.fill(alphaAt(y), y * width, (y + 1) * width);
		}
	}
	return mask;
}

/**
 * Offset de 50%/50% com wrap: troca os quadrantes em diagonal. Ao fim, as
 * bordas originais (que não casavam) estão no meio, e as novas bordas são
 * colunas/linhas que eram vizinhas no original — logo, casam.
 *
 * O canvas nasce com 4 canais e fundo transparente de propósito: PNG com alfa
 * atravessa o offset intacto. Achatar sobre branco aqui destruiria a
 * transparência de quem manda um PNG recortado.
 */
async function offsetHalf(
	src: Buffer,
	width: number,
	height: number,
): Promise<Buffer> {
	const hw = width >> 1;
	const hh = height >> 1;
	const rw = width - hw;
	const rh = height - hh;
	const cut = (left: number, top: number, w: number, h: number) =>
		sharp(src).extract({ left, top, width: w, height: h }).png().toBuffer();

	const [tl, tr, bl, br] = await Promise.all([
		cut(0, 0, hw, hh),
		cut(hw, 0, rw, hh),
		cut(0, hh, hw, rh),
		cut(hw, hh, rw, rh),
	]);

	return sharp({
		create: {
			width,
			height,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite([
			{ input: br, left: 0, top: 0 },
			{ input: bl, left: rw, top: 0 },
			{ input: tr, left: 0, top: rh },
			{ input: tl, left: rw, top: rh },
		])
		.png()
		.toBuffer();
}

/**
 * Compõe a imagem espelhada sobre ela mesma, com a máscara de faixa como alfa.
 *
 * A máscara é aplicada MULTIPLICANDO o alfa que a imagem já tem (em vez de
 * `joinChannel`) porque `joinChannel` depende de quantos canais o encoder
 * decidiu gravar — um PNG que o sharp escreve em tons de cinza tem 1 canal, e a
 * máscara entraria no canal errado, em silêncio. A passada RGBA explícita não
 * tem esse modo de falha e ainda respeita a transparência da origem.
 */
async function mirrorBlend(
	src: Buffer,
	width: number,
	height: number,
	axis: 'x' | 'y',
	seam: number,
	band: number,
): Promise<Buffer> {
	const mirrored = sharp(src);
	const { data } = await (axis === 'x' ? mirrored.flop() : mirrored.flip())
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const mask = seamBandMask(width, height, axis, seam, band);
	for (let i = 0; i < mask.length; i++) {
		data[i * 4 + 3] = (data[i * 4 + 3] * mask[i]) / 255;
	}

	return sharp(src)
		.composite([
			{ input: data, raw: { width, height, channels: 4 }, left: 0, top: 0 },
		])
		.png()
		.toBuffer();
}

/**
 * Torna a imagem repetível. Devolve PNG.
 *
 * `bandPct` é a fração do lado usada na transição. Mais faixa = emenda mais
 * escondida e mais "fantasma" de espelho no meio; menos faixa = o inverso.
 * 12% é o ponto onde textura orgânica fica convincente sem borrar o miolo.
 */
export async function makeTileable(
	input: Buffer,
	bandPct: number = DEFAULT_BAND_PCT,
): Promise<Buffer> {
	const meta = await sharp(input).metadata();
	const width = meta.width ?? 0;
	const height = meta.height ?? 0;
	if (!width || !height) {
		throw new ToolEngineError(400, 'Não consegui ler as dimensões da imagem.');
	}
	if (width * height > MAX_TILE_PIXELS) {
		throw new ToolEngineError(
			400,
			`Imagem grande demais para virar textura: ${width}×${height}px (teto ${
				MAX_TILE_PIXELS / 1_000_000
			} MP).`,
		);
	}
	// Abaixo de 8px não há faixa de transição possível; devolver a entrada é
	// mais honesto que produzir um borrão.
	if (width < 8 || height < 8) return sharp(input).png().toBuffer();

	const hw = width >> 1;
	const hh = height >> 1;
	const seamX = width - hw;
	const seamY = height - hh;
	const bandX = Math.max(2, Math.round(width * bandPct));
	const bandY = Math.max(2, Math.round(height * bandPct));

	const offset = await offsetHalf(input, width, height);
	// Sequencial (X e depois Y) em vez de dois composites de uma vez: o blend
	// vertical enxerga a emenda horizontal JÁ corrigida, então o cruzamento das
	// duas faixas — o centro exato, onde se encontram os 4 cantos do original —
	// sai limpo em vez de misturar um lado já resolvido com um lado cru.
	const blendedX = await mirrorBlend(offset, width, height, 'x', seamX, bandX);
	const blended = await mirrorBlend(blendedX, width, height, 'y', seamY, bandY);

	// O canvas do offset é RGBA, então uma entrada opaca sairia daqui com um
	// canal alfa inútil e ~30% mais pesada. Devolve como entrou.
	if (meta.hasAlpha) return blended;
	return sharp(blended).removeAlpha().png().toBuffer();
}

/* ─────────────────────────── bloco ─────────────────────────── */

const tileSchema = z.object({
	image: z.instanceof(Buffer),
	band_pct: z.coerce.number().min(0.02).max(0.45).default(DEFAULT_BAND_PCT),
});

export const imageMakeTileableBlock: ToolBlock<z.infer<typeof tileSchema>> = {
	id: 'image.make_tileable',
	category: 'image',
	description:
		'Torna a imagem repetível sem emenda (offset + blend espelhado). Ótimo em textura orgânica; fraco em padrão geométrico regular.',
	paramsSchema: tileSchema,
	async run(_ctx, params) {
		const png = await makeTileable(params.image, params.band_pct);
		return {
			png,
			pngBase64: `data:image/png;base64,${png.toString('base64')}`,
			tileable: true,
		};
	},
};

export const tileBlocks: ToolBlock[] = [imageMakeTileableBlock];
