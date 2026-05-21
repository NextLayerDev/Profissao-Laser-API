import { z } from 'zod';

export const cursoSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	image: z.string().nullable(),
	slug: z.string(),
	status: z.enum(['ativo', 'inativo', 'excluido']),
	price: z.number(),
	stripeProductId: z.string().nullable(),
	stripePriceId: z.string().nullable(),
	aulas: z.boolean(),
	suporte: z.boolean(),
	biblioteca: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type Curso = z.infer<typeof cursoSchema>;

export const createCursoSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	image: z.string().optional(),
	price: z.number().positive(),
	interval: z.enum(['month', 'year', 'one_time']).default('one_time'),
	slug: z.string().optional(),
	aulas: z.boolean().default(true),
	suporte: z.boolean().default(false),
	biblioteca: z.boolean().default(false),
});

export type CursoCreate = z.infer<typeof createCursoSchema>;

export const updateCursoSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	price: z.number().positive().optional(),
	aulas: z.boolean().optional(),
	suporte: z.boolean().optional(),
	biblioteca: z.boolean().optional(),
});

export type CursoUpdate = z.infer<typeof updateCursoSchema>;

export const updateCursoStatusSchema = z.object({
	active: z.boolean(),
});

export type CursoUpdateStatus = z.infer<typeof updateCursoStatusSchema>;
