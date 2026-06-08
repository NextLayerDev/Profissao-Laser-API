import { z } from 'zod';

// ─── Design entity ────────────────────────────────────────────────────────

export const designSchema = z.object({
	id: z.uuid(),
	customerId: z.string(),
	name: z.string(),
	templateId: z.string().nullable(),
	canvasJson: z.unknown(),
	thumbnailUrl: z.string().nullable(),
	width: z.number().int(),
	height: z.number().int(),
	notes: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type Design = z.infer<typeof designSchema>;

// ─── Create ───────────────────────────────────────────────────────────────

export const createDesignSchema = z.object({
	name: z.string().min(1).max(120),
	templateId: z.uuid().optional(),
	canvasJson: z.unknown(),
	thumbnailUrl: z.string().optional(),
	width: z.number().int().min(1).max(8192).default(1024),
	height: z.number().int().min(1).max(8192).default(1024),
	notes: z.string().max(2000).optional(),
});

export type CreateDesignInput = z.infer<typeof createDesignSchema>;

// ─── Update (PUT — corpo completo de save) ────────────────────────────────

export const updateDesignSchema = z.object({
	name: z.string().min(1).max(120).optional(),
	canvasJson: z.unknown().optional(),
	thumbnailUrl: z.string().optional(),
	width: z.number().int().min(1).max(8192).optional(),
	height: z.number().int().min(1).max(8192).optional(),
	notes: z.string().max(2000).optional(),
});

export type UpdateDesignInput = z.infer<typeof updateDesignSchema>;

// ─── List ─────────────────────────────────────────────────────────────────

export const designListQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(50).default(20),
	templateId: z.uuid().optional(),
	search: z.string().optional(),
});

export const designListResponseSchema = z.object({
	data: z.array(designSchema),
	total: z.number(),
	page: z.number(),
	limit: z.number(),
});
