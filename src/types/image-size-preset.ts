import { z } from 'zod';

/**
 * Resoluções padrão cadastradas pelo admin (`pl_image_size_preset`), globais
 * pra qualquer tool. Usadas como uma das formas de `data.image_size` num item
 * do Banco (ver `bankImageSizeSchema` em `types/tool-bank.ts`).
 */
const dim = z.number().int().min(64).max(4096);

export const imageSizePresetSchema = z.object({
	id: z.string(),
	name: z.string(),
	width: z.number().int(),
	height: z.number().int(),
	created_at: z.string(),
	updated_at: z.string(),
});
export type ImageSizePreset = z.infer<typeof imageSizePresetSchema>;

export const createImageSizePresetSchema = z.object({
	name: z.string().min(1).max(80),
	width: dim,
	height: dim,
});
export type CreateImageSizePreset = z.infer<typeof createImageSizePresetSchema>;

export const updateImageSizePresetSchema =
	createImageSizePresetSchema.partial();
export type UpdateImageSizePreset = z.infer<typeof updateImageSizePresetSchema>;
