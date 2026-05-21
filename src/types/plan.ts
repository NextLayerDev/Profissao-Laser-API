import { z } from 'zod';
import { cursoSchema } from './curso.js';

export const planSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	status: z.enum(['ativo', 'inativo']),
	price: z.number(),
	stripeProductId: z.string().nullable(),
	stripePriceId: z.string().nullable(),
	// Funcionalidades de ferramentas
	previas: z.boolean(),
	canva: z.boolean(),
	vetorizacao: z.boolean(),
	parametros: z.boolean(),
	fornecedores: z.boolean(),
	// Conteúdo incluso no plano
	aulas: z.boolean(),
	suporte: z.boolean(),
	biblioteca: z.boolean(),
	comunidade: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type Plan = z.infer<typeof planSchema>;

export const planWithCursosSchema = planSchema.extend({
	cursos: z.array(cursoSchema),
});

export type PlanWithCursos = z.infer<typeof planWithCursosSchema>;

export const createPlanSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	status: z.enum(['ativo', 'inativo']).default('ativo'),
	price: z.number().positive(),
	interval: z.enum(['month', 'year', 'one_time']).default('month'),
	// Funcionalidades de ferramentas
	previas: z.boolean().default(false),
	canva: z.boolean().default(false),
	vetorizacao: z.boolean().default(false),
	parametros: z.boolean().default(false),
	fornecedores: z.boolean().default(false),
	// Conteúdo incluso
	aulas: z.boolean().default(false),
	suporte: z.boolean().default(false),
	biblioteca: z.boolean().default(false),
	comunidade: z.boolean().default(false),
});

export type PlanCreate = z.infer<typeof createPlanSchema>;

export const updatePlanSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	status: z.enum(['ativo', 'inativo']).optional(),
	price: z.number().positive().optional(),
	// Funcionalidades de ferramentas
	previas: z.boolean().optional(),
	canva: z.boolean().optional(),
	vetorizacao: z.boolean().optional(),
	parametros: z.boolean().optional(),
	fornecedores: z.boolean().optional(),
	// Conteúdo incluso
	aulas: z.boolean().optional(),
	suporte: z.boolean().optional(),
	biblioteca: z.boolean().optional(),
	comunidade: z.boolean().optional(),
});

export type PlanUpdate = z.infer<typeof updatePlanSchema>;

export const addCursoToPlanSchema = z.object({
	cursoId: z.string(),
});
