import { z } from 'zod';
import { productSchema } from './product.js';

export const classSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	tier: z.enum(['prata', 'ouro', 'platina']),
	description: z.string().nullable(),
	status: z.enum(['ativo', 'inativo']),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const classWithProductsSchema = classSchema.extend({
	products: z.array(productSchema),
});

export const createClassSchema = z.object({
	name: z.string(),
	tier: z.enum(['prata', 'ouro', 'platina']),
	description: z.string().optional(),
	status: z.enum(['ativo', 'inativo']).default('ativo'),
});

export const updateClassSchema = z.object({
	name: z.string().optional(),
	tier: z.enum(['prata', 'ouro', 'platina']).optional(),
	description: z.string().optional(),
	status: z.enum(['ativo', 'inativo']).optional(),
});

export const addProductToClassSchema = z.object({
	productId: z.string(),
});

export type ClassCreate = z.infer<typeof createClassSchema>;
export type ClassUpdate = z.infer<typeof updateClassSchema>;
