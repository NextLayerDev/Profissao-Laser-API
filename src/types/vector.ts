import { z } from 'zod';

export const vectorSchema = z.object({
	id: z.string().uuid(),
	customer_id: z.string().uuid(),
	original_name: z.string(),
	original_url: z.string().nullable(),
	svg_url: z.string(),
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

export type VectorCreate = z.infer<typeof createVectorSchema>;
export type VectorUpdate = z.infer<typeof updateVectorSchema>;
export type ListVectorsQuery = z.infer<typeof listVectorsQuery>;
