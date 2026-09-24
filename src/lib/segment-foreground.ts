// ─────────────────────────────────────────────────────────────────────
// Segmentação real de sujeito (RMBG-1.4/BRIA via @imgly/background-removal-node).
// Portado do StickerAI do comunidade_laser (src/lib/services/background-remove.ts),
// onde já roda em produção. Não é IA generativa que "reinterpreta" a imagem — é
// um modelo de segmentação: devolve um PNG RGBA com o SUJEITO nas cores
// ORIGINAIS e o fundo 100% transparente (alpha=0).
//
// SÓ PRA FOTO: testado nos dois sentidos — funciona muito bem em foto real
// (objeto/produto fotografado, fundo de estúdio/vinheta), mas em arte flat
// (logo/wordmark com letras brancas sobre fundo sólido) o modelo confunde as
// próprias letras com "fundo" e devolve o texto fantasma/semitransparente.
// Por isso o roteamento em `vectorize-color.ts` só chama isto quando
// `classifyImage()` (mesmo classificador já usado pro prompt P&B) diz 'photo';
// pra 'logo' o chroma-key das bordas já resolve melhor.
// ─────────────────────────────────────────────────────────────────────

export class SegmentationUnavailableError extends Error {}

const SEGMENTATION_MODEL: 'small' | 'medium' | 'large' =
	process.env.VECTORIZE_SEGMENT_MODEL === 'medium' ||
	process.env.VECTORIZE_SEGMENT_MODEL === 'large'
		? process.env.VECTORIZE_SEGMENT_MODEL
		: 'small';

// O comunidade_laser aponta pro CDN (jsdelivr) porque roda em lambda da Vercel
// com teto de 250MB no artefato de deploy — os ~127MB de modelo empacotados
// localmente estourariam isso. Este backend é Docker/EasyPanel, sem esse teto,
// e usar o CDN tem um custo real: baixa o modelo (~44MB) A CADA CHAMADA (medido
// ~14s por vetorização, mesmo "aquecido" — o pacote não faz cache do download
// entre chamadas). Path local (default do pacote, já empacotado em
// node_modules) evita a rede por completo. Só usa CDN se explicitamente pedido.
const MODEL_PUBLIC_PATH: string | undefined =
	process.env.VECTORIZE_SEGMENT_MODEL_PUBLIC_PATH || undefined;

/**
 * Segmenta o sujeito principal, devolvendo um PNG RGBA com fundo transparente.
 * Lança `SegmentationUnavailableError` se o motor nativo (onnxruntime) não
 * carregar — chamador deve cair de volta pro chroma-key, nunca travar a
 * vetorização por causa disso.
 */
export async function segmentForeground(imageBuffer: Buffer): Promise<Buffer> {
	let removeBackgroundImgly: typeof import('@imgly/background-removal-node').default;
	try {
		const mod = await import('@imgly/background-removal-node');
		removeBackgroundImgly = mod.default;
	} catch (err) {
		throw new SegmentationUnavailableError(
			`Motor de segmentação indisponível: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	const blob = await removeBackgroundImgly(
		new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }),
		{
			model: SEGMENTATION_MODEL,
			publicPath: MODEL_PUBLIC_PATH,
			output: { format: 'image/png', quality: 0.8 },
		},
	);
	return Buffer.from(await blob.arrayBuffer());
}
