import { z } from 'zod';

export const laserProductStatusSchema = z.enum(['ativo', 'inativo']);

// ─── Variant ──────────────────────────────────────────────────────────────

export const laserProductVariantSchema = z.object({
	id: z.uuid(),
	productId: z.uuid(),
	name: z.string(),
	colorName: z.string().nullable(),
	colorHex: z.string().nullable(),
	tipo: z.string().nullable(),
	imageUrl: z.string(),
	order: z.number().int(),
	status: laserProductStatusSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type LaserProductVariant = z.infer<typeof laserProductVariantSchema>;

// Base do create — validamos colorName OR tipo no refine
const createLaserProductVariantBase = z.object({
	name: z.string().min(1).max(120),
	colorName: z.string().max(60).optional(),
	colorHex: z
		.string()
		.regex(/^#?[0-9a-fA-F]{6}$/, 'Hex inválido (ex: #C0C0C0)')
		.optional(),
	tipo: z.string().max(60).optional(),
	imageUrl: z.string(),
	order: z.number().int().min(0).default(0),
	status: laserProductStatusSchema.default('ativo'),
});

export const createLaserProductVariantSchema =
	createLaserProductVariantBase.refine(
		(data) => !!(data.colorName || data.tipo),
		{ message: 'Pelo menos colorName ou tipo deve ser informado' },
	);

export type CreateLaserProductVariantInput = z.infer<
	typeof createLaserProductVariantSchema
>;

export const updateLaserProductVariantSchema = z.object({
	name: z.string().min(1).max(120).optional(),
	colorName: z.string().max(60).nullable().optional(),
	colorHex: z
		.string()
		.regex(/^#?[0-9a-fA-F]{6}$/, 'Hex inválido (ex: #C0C0C0)')
		.nullable()
		.optional(),
	tipo: z.string().max(60).nullable().optional(),
	imageUrl: z.string().optional(),
	order: z.number().int().min(0).optional(),
	status: laserProductStatusSchema.optional(),
});

export type UpdateLaserProductVariantInput = z.infer<
	typeof updateLaserProductVariantSchema
>;

// ─── Product ──────────────────────────────────────────────────────────────

export const laserProductSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	category: z.string(),
	defaultMaterial: z.string().nullable(),
	tags: z.array(z.string()),
	status: laserProductStatusSchema,
	createdBy: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type LaserProduct = z.infer<typeof laserProductSchema>;

// Produto com variants embedded (usado no GET /:id)
export const laserProductWithVariantsSchema = laserProductSchema.extend({
	variants: z.array(laserProductVariantSchema),
});

export type LaserProductWithVariants = z.infer<
	typeof laserProductWithVariantsSchema
>;

export const createLaserProductSchema = z.object({
	name: z.string().min(1).max(120),
	description: z.string().max(2000).optional(),
	category: z.string().min(1).max(60),
	defaultMaterial: z.string().max(60).optional(),
	tags: z.array(z.string()).default([]),
	status: laserProductStatusSchema.default('ativo'),
});

export type CreateLaserProductInput = z.infer<typeof createLaserProductSchema>;

export const updateLaserProductSchema = z.object({
	name: z.string().min(1).max(120).optional(),
	description: z.string().max(2000).nullable().optional(),
	category: z.string().min(1).max(60).optional(),
	defaultMaterial: z.string().max(60).nullable().optional(),
	tags: z.array(z.string()).optional(),
	status: laserProductStatusSchema.optional(),
});

export type UpdateLaserProductInput = z.infer<typeof updateLaserProductSchema>;

// ─── List query / response ────────────────────────────────────────────────

export const laserProductListQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(50).default(20),
	category: z.string().optional(),
	search: z.string().optional(),
	status: laserProductStatusSchema.optional(),
});

export const laserProductListResponseSchema = z.object({
	data: z.array(laserProductSchema),
	total: z.number(),
	page: z.number(),
	limit: z.number(),
});

export const laserProductVariantListResponseSchema = z.array(
	laserProductVariantSchema,
);
