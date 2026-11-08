/**
 * Falha de um motor nativo/externo do fluxo Automático (segmentação, IA,
 * Potrace). Módulo próprio para `photo-negative`/`segmentation` lançarem sem
 * importar o pipeline (evita ciclo de import).
 */
export class UpstreamError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UpstreamError';
	}
}
