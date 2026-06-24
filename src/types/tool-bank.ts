import { z } from 'zod';

/**
 * Banco do Admin (Fábrica de Tools). Cada registro tem campos universais de card
 * (title/category/exemplos) + `data` livre (os campos declarados em `bank.fields`
 * da ToolDefinition — ex.: prompt_script, mode). O cliente vê a galeria; o motor
 * injeta o registro escolhido no pipeline (ToolDefinition.bank.inject).
 */

/** Campos livres do registro (definidos pela tool via `bank.fields`). */
export const toolBankDataSchema = z.record(z.string(), z.unknown());

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
