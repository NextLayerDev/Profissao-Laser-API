import { segmentForeground } from '../segment-foreground.js';
import { UpstreamError } from './errors.js';

/**
 * Segmentação real do sujeito (RMBG-1.4) para o fluxo Automático. Reusa o
 * `segmentForeground` do backend (modelo local, sem baixar do CDN a cada
 * chamada) e traduz qualquer falha em `UpstreamError`, que o chamador trata
 * seguindo sem a silhueta.
 */
export async function segmentSubjectPng(imagePng: Buffer): Promise<Buffer> {
	try {
		return await segmentForeground(imagePng);
	} catch (err) {
		throw new UpstreamError(
			`Erro na remoção de fundo (segmentação): ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}
