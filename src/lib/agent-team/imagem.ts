import sharp from 'sharp';

/**
 * A FOTO A CAMINHO DO MODELO — e a maior alavanca de custo de quem usa visão.
 *
 * Custa quatro linhas e vale muito: uma foto de celular crua (4000 px) vira
 * ~6k tokens de entrada; a mesma foto em 1024 px JPEG q80 vira ~1,5k. Nenhum
 * modelo enxerga material, furo ou acabamento melhor em 4000 px do que em
 * 1024 — o que ele perde nessa redução não é informação que a análise use.
 *
 * ┌─ POR QUE ISTO É UM MÓDULO E NÃO UMA FUNÇÃO PRIVADA ─────────────────────┐
 * │ Eram duas: uma no `ai.vision` e outra a caminho no time do Ateliê, que   │
 * │ manda foto de produto e anúncios de referência na mesma chamada. Duas    │
 * │ cópias de "quanto custa mandar uma foto" é a forma mais fácil de alguém  │
 * │ abaixar o lado num lugar e a conta continuar errada no outro — e este    │
 * │ número aparece TAMBÉM na projeção de custo (`CHARS_POR_IMAGEM`), que é o │
 * │ que autoriza a chamada a sair.                                           │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/** Lado máximo da imagem enviada ao modelo. */
export const LADO_PADRAO = 1024;
const JPEG_Q = 80;

/**
 * Quantos tokens de ENTRADA uma imagem reduzida vale, para efeito de projeção.
 *
 * ~1.500 é o que uma foto de 1024 px em JPEG q80 mede nos modelos do catálogo
 * (todos multimodais). Não é preciso ser exato: a projeção existe para ser
 * PIOR CASO e frear a chamada antes de ela sair — errar para mais aqui custa
 * um agente cortado, errar para menos custa o freio não existir.
 */
export const TOKENS_POR_IMAGEM = 1_500;

/**
 * Reduz e recomprime antes do base64. Falha aqui NÃO derruba o run: se o
 * `sharp` não reconhecer o arquivo, mandamos o buffer original e deixamos o
 * modelo decidir — pior caso é gastar mais token, não quebrar a análise.
 */
export async function imagemParaDataUrl(
	buf: Buffer,
	maxSide: number = LADO_PADRAO,
): Promise<string> {
	try {
		const menor = await sharp(buf)
			.rotate() // respeita o EXIF: foto de celular deitada chega em pé
			.resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
			.jpeg({ quality: JPEG_Q })
			.toBuffer();
		return `data:image/jpeg;base64,${menor.toString('base64')}`;
	} catch {
		return `data:image/jpeg;base64,${buf.toString('base64')}`;
	}
}
