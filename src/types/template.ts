import { z } from 'zod';

export const templateTipoSchema = z.enum(['base', 'exemplo', 'referencia']);
export type TemplateTipo = z.infer<typeof templateTipoSchema>;

export const templateStatusSchema = z.enum(['ativo', 'inativo']);

// ─── Template entity (DB row → API response) ──────────────────────────────

export const templateSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	categoryId: z.string(),
	tipoImagem: templateTipoSchema,
	imageUrl: z.string(),
	canvasJson: z.unknown().nullable(),
	tags: z.array(z.string()),
	width: z.number().int(),
	height: z.number().int(),
	status: templateStatusSchema,
	createdBy: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type Template = z.infer<typeof templateSchema>;

// ─── Create (admin) ───────────────────────────────────────────────────────

export const createTemplateSchema = z.object({
	name: z.string().min(1).max(120),
	description: z.string().max(2000).optional(),
	categoryId: z.string().min(1).max(60),
	tipoImagem: templateTipoSchema.default('base'),
	imageUrl: z.string(),
	canvasJson: z.unknown().optional(),
	tags: z.array(z.string()).default([]),
	width: z.number().int().min(1).max(8192).default(1024),
	height: z.number().int().min(1).max(8192).default(1024),
	status: templateStatusSchema.default('ativo'),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

// ─── Update (admin) ───────────────────────────────────────────────────────

export const updateTemplateSchema = z.object({
	name: z.string().min(1).max(120).optional(),
	description: z.string().max(2000).optional(),
	categoryId: z.string().min(1).max(60).optional(),
	tipoImagem: templateTipoSchema.optional(),
	imageUrl: z.string().optional(),
	canvasJson: z.unknown().optional(),
	tags: z.array(z.string()).optional(),
	width: z.number().int().min(1).max(8192).optional(),
	height: z.number().int().min(1).max(8192).optional(),
	status: templateStatusSchema.optional(),
});

export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

// ─── List query / response ────────────────────────────────────────────────

export const templateListQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(50).default(20),
	categoryId: z.string().optional(),
	tipoImagem: templateTipoSchema.optional(),
	tag: z.string().optional(),
	search: z.string().optional(),
	status: templateStatusSchema.optional(),
});

export const templateListResponseSchema = z.object({
	data: z.array(templateSchema),
	total: z.number(),
	page: z.number(),
	limit: z.number(),
});

// ─── Clone (customer) ─────────────────────────────────────────────────────

export const cloneTemplateSchema = z.object({
	name: z.string().min(1).max(120).optional(),
	notes: z.string().max(2000).optional(),
});

export type CloneTemplateInput = z.infer<typeof cloneTemplateSchema>;
