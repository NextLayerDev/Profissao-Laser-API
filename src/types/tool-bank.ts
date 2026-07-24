import { z } from 'zod';
import { mmToPx } from '../lib/laser-prep.js';

/**
 * Banco do Admin (Fábrica de Tools). Cada registro tem campos universais de card
 * (title/category/exemplos) + `data` livre (os campos declarados em `bank.fields`
 * da ToolDefinition — ex.: prompt_script, mode). O cliente vê a galeria; o motor
 * injeta o registro escolhido no pipeline (ToolDefinition.bank.inject).
 */

/** Campos livres do registro (definidos pela tool via `bank.fields`). */
export const toolBankDataSchema = z.record(z.string(), z.unknown());

const pxDim = z.number().int().min(64).max(4096);

/**
 * Tamanho de saída que o admin define por item do banco (`data.image_size`).
 * Aceita px direto, mm+dpi (convertido via `mmToPx`, mesmo usado no laser-prep)
 * ou o id de uma resolução padrão cadastrada em `pl_image_size_preset`
 * (`GET /api/image-size-presets`) — sempre resolvido para px antes de gravar
 * (`image_size_px`).
 */
export const bankImageSizeSchema = z.discriminatedUnion('unit', [
	z.object({ unit: z.literal('px'), width: pxDim, height: pxDim }),
	z.object({
		unit: z.literal('mm'),
		width: z.number().positive().max(2000),
		height: z.number().positive().max(2000),
		dpi: z.number().int().min(72).max(1200).default(300),
	}),
	z.object({ unit: z.literal('preset'), preset_id: z.string().min(1) }),
]);
export type BankImageSizeInput = z.infer<typeof bankImageSizeSchema>;

/**
 * Resolve qualquer forma de `image_size` para px, com clamp nos limites do
 * bloco `ai.generate_image`. `lookupPreset` busca a resolução cadastrada
 * (`imageSizePresetRepository.findById`) — só é chamado quando `unit === 'preset'`.
 */
export async function resolveImageSizePx(
	input: BankImageSizeInput,
	lookupPreset: (
		id: string,
	) => Promise<{ width: number; height: number } | null>,
): Promise<{ width: number; height: number }> {
	if (input.unit === 'px') return { width: input.width, height: input.height };
	if (input.unit === 'preset') {
		const preset = await lookupPreset(input.preset_id);
		if (!preset) throw new Error('Resolução padrão não encontrada.');
		return preset;
	}
	const clamp = (px: number) => Math.min(4096, Math.max(64, px));
	return {
		width: clamp(mmToPx(input.width, input.dpi)),
		height: clamp(mmToPx(input.height, input.dpi)),
	};
}

export const toolBankEntrySchema = z.object({
	id: z.string(),
	tool_key: z.string(),
	title: z.string(),
	description: z.string().nullable(),
	category: z.string().nullable(),
	position: z.number().int(),
	active: z.boolean(),
	data: toolBankDataSchema,
	example_before_url: z.string().nullable(),
	example_after_url: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string(),
});
export type ToolBankEntry = z.infer<typeof toolBankEntrySchema>;

export const createToolBankEntrySchema = z.object({
	title: z.string().min(1).max(200),
	description: z.string().max(2000).optional(),
	category: z.string().max(80).optional(),
	position: z.number().int().optional().default(0),
	active: z.boolean().optional().default(true),
	data: toolBankDataSchema.optional().default({}),
	example_before_url: z.string().nullable().optional(),
	example_after_url: z.string().nullable().optional(),
});
export type CreateToolBankEntry = z.infer<typeof createToolBankEntrySchema>;

export const updateToolBankEntrySchema = createToolBankEntrySchema.partial();
export type UpdateToolBankEntry = z.infer<typeof updateToolBankEntrySchema>;

export const reorderToolBankSchema = z.object({
	ids: z.array(z.string()),
});
