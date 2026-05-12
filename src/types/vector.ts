import { z } from 'zod';

export const vectorSchema = z.object({
	id: z.string().uuid(),
	customer_id: z.string().uuid(),
	original_name: z.string(),
	original_url: z.string().nullable(),
	svg_url: z.string(),
	params: z.record(z.string(), z.unknown()).nullable().optional(),
	created_at: z.string(),
	updated_at: z.string(),
});

export const createVectorSchema = z.object({
	svgContent: z.string(),
	originalName: z.string(),
	customerId: z.string().uuid().optional(),
});

export const updateVectorSchema = z.object({
	svgContent: z.string().optional(),
	originalName: z.string().optional(),
});

export const listVectorsQuery = z.object({
	page: z.coerce.number().int().positive().default(1),
	limit: z.coerce.number().int().positive().max(100).default(20),
	search: z.string().optional(),
	customerId: z.string().uuid().optional(),
});

export const vectorizeParamsSchema = z.object({
	mode: z.enum(['contorno', 'detalhado', 'preenchimento']).default('detalhado'),
	detailLevel: z.coerce.number().int().min(0).max(100).default(50),
	smoothing: z.coerce.number().int().min(0).max(100).default(0),
	noiseReduction: z.coerce.number().int().min(0).max(100).default(0),
	blackAndWhite: z.boolean().default(false),
	invertColors: z.boolean().default(false),
});

export const vectorizeResultSchema = vectorSchema.extend({
	dxfContent: z.string().optional(),
	pngUrl: z.string().optional(),
});

export const batchVectorizeResultSchema = z.object({
	results: z.array(vectorizeResultSchema),
	total: z.number(),
	succeeded: z.number(),
	failed: z.number(),
});

export const exportFormatSchema = z.enum(['dxf', 'png']);

export type VectorCreate = z.infer<typeof createVectorSchema>;
export type VectorUpdate = z.infer<typeof updateVectorSchema>;
export type ListVectorsQuery = z.infer<typeof listVectorsQuery>;
export type VectorizeParams = z.infer<typeof vectorizeParamsSchema>;
export type ExportFormat = z.infer<typeof exportFormatSchema>;
