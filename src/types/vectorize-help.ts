import { z } from 'zod';

// ─── Enums ────────────────────────────────────────────────────────────────

export const vectorizeHelpIconSchema = z.enum([
	'play',
	'zap',
	'image',
	'help-circle',
	'book-open',
	'lightbulb',
	'video',
	'file-text',
	'layers',
	'target',
]);

export const vectorizeHelpTypeSchema = z.enum(['text', 'video']);

// ─── Entity (admin response — completo) ───────────────────────────────────

export const vectorizeHelpSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	description: z.string(),
	icon: vectorizeHelpIconSchema,
	type: vectorizeHelpTypeSchema,
	content: z.string().nullable(),
	video_url: z.string().nullable(),
	order: z.number().int(),
	active: z.boolean(),
	created_at: z.string(),
	updated_at: z.string(),
});

export type VectorizeHelp = z.infer<typeof vectorizeHelpSchema>;

export const vectorizeHelpListSchema = z.array(vectorizeHelpSchema);

// ─── Entity slim (GET /vectorize-help/active — front do aluno) ────────────
// Sem `active` nem timestamps, conforme spec API Gaps 3.0.

export const vectorizeHelpActiveSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	description: z.string(),
	icon: vectorizeHelpIconSchema,
	type: vectorizeHelpTypeSchema,
	content: z.string().nullable(),
	video_url: z.string().nullable(),
	order: z.number().int(),
});

export const vectorizeHelpActiveListSchema = z.array(vectorizeHelpActiveSchema);

// ─── Create (body) ────────────────────────────────────────────────────────

export const createVectorizeHelpSchema = z.object({
	title: z.string().min(1).max(255),
	description: z.string().min(1).max(500),
	icon: vectorizeHelpIconSchema,
	type: vectorizeHelpTypeSchema,
	content: z.string().nullable().optional(),
	video_url: z.string().nullable().optional(),
	order: z.number().int().min(0).optional(),
	active: z.boolean().optional(),
});

export type CreateVectorizeHelpInput = z.infer<
	typeof createVectorizeHelpSchema
>;

// ─── Update (body — tudo opcional) ────────────────────────────────────────

export const updateVectorizeHelpSchema = z.object({
	title: z.string().min(1).max(255).optional(),
	description: z.string().min(1).max(500).optional(),
	icon: vectorizeHelpIconSchema.optional(),
	type: vectorizeHelpTypeSchema.optional(),
	content: z.string().nullable().optional(),
	video_url: z.string().nullable().optional(),
	order: z.number().int().min(0).optional(),
	active: z.boolean().optional(),
});

export type UpdateVectorizeHelpInput = z.infer<
	typeof updateVectorizeHelpSchema
>;

// ─── Reorder (body) ───────────────────────────────────────────────────────

export const reorderVectorizeHelpSchema = z.object({
	ids: z.array(z.uuid()).min(1),
});

export type ReorderVectorizeHelpInput = z.infer<
	typeof reorderVectorizeHelpSchema
>;
