import type { Creation, ToolDefinitionDoc } from './tool-definitions.js';
import { ToolEngineError } from './tool-errors.js';

/**
 * Resolve o "Tipo de Criação" (Passo 1) escolhido pelo cliente a partir do
 * campo multipart `creation_id`, contra a allowlist `definition.creations`.
 *
 * - Tool sem `creations` (legado) → devolve `undefined` em ambos (cai em
 *   `image_width/height` legado ou saída nativa do modelo).
 * - Tool com `creations` + `creation_id` válido e ativo → devolve `{width,height}`.
 * - Tool com `creations` mas sem `creation_id` → 400 "Escolha um tipo de criação."
 *   (antes do billing — não cobra).
 * - `creation_id` inexistente ou `active:false` → 400 "Tipo de criação inválido."
 *
 * Exportado puro (sem deps de controller) pra ser testado isoladamente.
 */
export function resolveCreation(
	doc: Pick<ToolDefinitionDoc, 'creations'>,
	creationId: string | undefined,
): { width?: number; height?: number } {
	const creations = doc.creations ?? [];
	if (creations.length === 0) return { width: undefined, height: undefined };
	if (!creationId) {
		throw new ToolEngineError(400, 'Escolha um tipo de criação.');
	}
	const c = creations.find(
		(x: Creation) => x.id === creationId && x.active !== false,
	);
	if (!c) {
		throw new ToolEngineError(400, 'Tipo de criação inválido.');
	}
	return { width: c.width, height: c.height };
}

/**
 * Valida `variation_count` (Passo 3, campo multipart string) contra o allowlist
 * `definition.return_variations`. Default = 1º elemento (ou 1 se vazio).
 * Lança `ToolEngineError(400)` se vier valor fora do permitido — antes do
 * billing, então o cliente não paga por escolha inválida.
 */
export function resolveVariationCount(
	raw: string | undefined,
	allowed: number[],
): number {
	const def = allowed[0] ?? 1;
	if (!raw) return def;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || !allowed.includes(n)) {
		throw new ToolEngineError(400, 'Quantidade de variações inválida.');
	}
	return n;
}
