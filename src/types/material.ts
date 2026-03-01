import { z } from 'zod';

export const MATERIAL_TYPES = ['pdf', 'word', 'odt', 'image'] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];

export const materialSchema = z.object({
	id: z.string().uuid(),
	lessonId: z.string(),
	name: z.string(),
	url: z.string().url(),
	type: z.enum(MATERIAL_TYPES),
	createdAt: z.string(),
});

export const createMaterialSchema = z.object({
	name: z.string(),
	url: z.string().url(),
	type: z.enum(MATERIAL_TYPES),
});

export type MaterialCreate = z.infer<typeof createMaterialSchema>;
