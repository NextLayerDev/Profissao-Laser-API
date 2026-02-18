import { z } from 'zod';

export const moduleSchema = z.object({
	id: z.string(),
	productId: z.string(),
	title: z.string(),
	description: z.string().nullable(),
	order: z.number().int(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type Module = z.infer<typeof moduleSchema>;

export const createModuleSchema = z.object({
	productId: z.string(),
	title: z.string(),
	description: z.string().optional(),
	order: z.number().int().nonnegative(),
});

export type ModuleCreate = z.infer<typeof createModuleSchema>;

export const updateModuleSchema = z.object({
	title: z.string().optional(),
	description: z.string().optional(),
	order: z.number().int().nonnegative().optional(),
});

export type ModuleUpdate = z.infer<typeof updateModuleSchema>;
