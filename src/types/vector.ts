import { z } from 'zod';

export const vectorizeParamsSchema = z.object({
	mode: z.enum(['contour', 'detailed', 'fill']).default('detailed'),
	detailLevel: z.number().int().min(0).max(100).default(50),
	smoothing: z.number().int().min(0).max(100).default(50),
	noiseReduction: z.number().int().min(0).max(100).default(20),
	blackAndWhite: z.boolean().default(false),
	invertColors: z.boolean().default(false),
});

export const vectorSchema = z.object({
	id: z.string().uuid(),
	customer_id: z.string().uuid(),
	original_name: z.string(),
	original_url: z.string().nullable(),
	svg_url: z.string(),
	dxf_url: z.string().nullable().optional(),
	png_url: z.string().nullable().optional(),
	params: vectorizeParamsSchema.partial().nullable().optional(),
	created_at: z.string(),
	updated_at: z.string(),
});

export const vectorizeResultSchema = z.object({
	svgContent: z.string(),
	svgUrl: z.string().nullable().optional(),
	dxfContent: z.string().nullable().optional(),
	dxfUrl: z.string().nullable().optional(),
	pngUrl: z.string().nullable().optional(),
	params: vectorizeParamsSchema,
});

export const vectorizeBatchSchema = z.object({
	files: z.array(
		z.object({
			name: z.string(),
			content: z.string(),
		}),
	),
	params: vectorizeParamsSchema.partial().optional(),
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

export type VectorCreate = z.infer<typeof createVectorSchema>;
export type VectorUpdate = z.infer<typeof updateVectorSchema>;
export type ListVectorsQuery = z.infer<typeof listVectorsQuery>;
export type VectorizeParams = z.infer<typeof vectorizeParamsSchema>;
export type VectorizeResult = z.infer<typeof vectorizeResultSchema>;
export type VectorizeBatch = z.infer<typeof vectorizeBatchSchema>;
