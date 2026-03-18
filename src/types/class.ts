import { z } from 'zod';
import { productSchema } from './product.js';

export const classSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	tier: z.enum(['prata', 'ouro', 'platina']),
	description: z.string().nullable(),
	status: z.enum(['ativo', 'inativo']),
	aula: z.boolean(),
	chat: z.boolean(),
	vetorizacao: z.boolean(),
	suporte: z.boolean(),
	comunidade: z.boolean(),
	canva: z.boolean(),
	system: z.boolean(),
	machine: z.string().nullable(),
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
	aula: z.boolean().default(false),
	chat: z.boolean().default(false),
	vetorizacao: z.boolean().default(false),
	suporte: z.boolean().default(false),
	comunidade: z.boolean().default(false),
	system: z.boolean().default(false),
	machine: z.string().nullable(),
	canva: z.boolean(),
});

export const updateClassSchema = z.object({
	name: z.string().optional(),
	tier: z.enum(['prata', 'ouro', 'platina']).optional(),
	description: z.string().optional(),
	status: z.enum(['ativo', 'inativo']).optional(),
	aula: z.boolean().optional(),
	chat: z.boolean().optional(),
	vetorizacao: z.boolean().optional(),
	suporte: z.boolean().optional(),
	comunidade: z.boolean().optional(),
	system: z.boolean().optional(),
	machine: z.string().optional(),
	canva: z.boolean().default(false).optional(),
});

export const addProductToClassSchema = z.object({
	productId: z.string(),
});

export type ClassCreate = z.infer<typeof createClassSchema>;
export type ClassUpdate = z.infer<typeof updateClassSchema>;
