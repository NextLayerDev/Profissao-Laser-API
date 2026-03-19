import { z } from 'zod';
import { classSchema } from './class.js';
import { productSchema } from './product.js';

export const systemClassSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	status: z.enum(['ativo', 'inativo']),
	gerenciamentoSistema: z.boolean(),
	iaPrevias: z.boolean(),
	iaWhatsappPrevias: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const systemClassWithRelationsSchema = systemClassSchema.extend({
	products: z.array(productSchema),
	classes: z.array(classSchema),
});

export const createSystemClassSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	status: z.enum(['ativo', 'inativo']).default('ativo'),
	sistemaGerenciamento: z.boolean().default(false),
	iaPrevias: z.boolean().default(false),
	iaWhatsappPrevias: z.boolean().default(false),
});

export const updateSystemClassSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	status: z.enum(['ativo', 'inativo']).optional(),
	sistemaGerenciamento: z.boolean().optional(),
	iaPrevias: z.boolean().optional(),
	iaWhatsappPrevias: z.boolean().optional(),
});

export const addProductToSystemClassSchema = z.object({
	productId: z.string(),
});

export const addClassToSystemClassSchema = z.object({
	classId: z.string(),
});

export type SystemClassCreate = z.infer<typeof createSystemClassSchema>;
export type SystemClassUpdate = z.infer<typeof updateSystemClassSchema>;
