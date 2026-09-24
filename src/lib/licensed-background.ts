import sharp from 'sharp';
import { removeBgBlock } from '../tool-blocks/blocks/ai-extra.js';
import type { BlockRunContext } from '../tool-blocks/types.js';

/**
 * Abaixo deste alfa o pixel conta como transparente — o mesmo limiar que o
 * carimbo usa para dizer "aqui é material cru".
 */
const ALFA_TRANSPARENTE = 32;

/**
 * A arte tem fundo transparente DE VERDADE?
 *
 * "De verdade" porque o modelo de imagem devolve, com frequência, um PNG opaco
 * pintado com o xadrez cinza-e-branco de "transparência" — que na tela parece
 * sem fundo e na máquina é uma placa inteira queimada em xadrez. Só o canal
 * alfa diz a verdade.
 */
export async function temFundoTransparente(png: Buffer): Promise<boolean> {
	const meta = await sharp(png).metadata();
	if (!meta.hasAlpha) return false;
	const { data } = await sharp(png)
		.ensureAlpha()
		.extractChannel(3)
		.raw()
		.toBuffer({ resolveWithObject: true });
	for (let i = 0; i < data.length; i++) {
		if (data[i] < ALFA_TRANSPARENTE) return true;
	}
	return false;
}

/**
 * Garante que a peça saia sem fundo.
 *
 * Se a arte já tem alfa real, volta como veio — nada a fazer e nada a
 * arriscar. Se veio opaca, passa pelo removedor de fundo HÍBRIDO da casa
 * (`image.removeBackground`): chroma-key das bordas quando o fundo é uniforme
 * (branco, cinza), IA isolando o sujeito sobre branco quando é complexo (o
 * xadrez falso cai aqui). É o mesmo removedor que o aluno usa no Ateliê —
 * "nem que tenha que passar pelo removedor antes" foi literalmente o pedido.
 */
export async function garantirSemFundo(
	png: Buffer,
	ctx: BlockRunContext,
): Promise<Buffer> {
	if (await temFundoTransparente(png)) return png;
	const saida = (await removeBgBlock.run(
		ctx,
		removeBgBlock.paramsSchema.parse({ image: png }),
	)) as { png?: unknown };
	if (!Buffer.isBuffer(saida.png)) {
		throw new Error('o removedor de fundo não devolveu imagem');
	}
	return saida.png;
}
