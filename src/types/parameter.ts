import { z } from 'zod';

export const parameterSchema = z.object({
	id: z.string(),
	material: z.string(),
	materialType: z.string(),
	thickness: z.string(),
	power: z.number(),
	speed: z.number(),
	frequency: z.number(),
	passes: z.number(),
	mode: z.string(),
	gas: z.string().nullable().optional(),
	machine: z.string().nullable().optional(),
	notes: z.string().nullable().optional(),
	createdBy: z.string(),
	createdByName: z.string().nullable().optional(),
	isPublic: z.boolean(),
	rating: z.number().nullable().optional(),
	likesCount: z.number().optional(),
	savesCount: z.number().optional(),
	isSaved: z.boolean().optional(),
	isLiked: z.boolean().optional(),
	userRating: z.number().nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const createParameterSchema = z.object({
	material: z.string().min(1),
	materialType: z.string().min(1),
	thickness: z.string().min(1),
	power: z.number().int().min(0).max(100),
	speed: z.number().int().min(0),
	frequency: z.number().int().min(0),
	passes: z.number().int().min(1).default(1),
	mode: z.string().min(1),
	gas: z.string().nullable().optional(),
	machine: z.string().nullable().optional(),
	notes: z.string().nullable().optional(),
	isPublic: z.boolean().default(false),
});

export const updateParameterSchema = createParameterSchema.partial();

export const listParametersQuery = z.object({
	page: z.coerce.number().int().positive().default(1),
	limit: z.coerce.number().int().positive().max(100).default(20),
	machine: z.string().optional(),
	model: z.string().optional(),
	material: z.string().optional(),
	thickness: z.string().optional(),
	search: z.string().optional(),
	mode: z.string().optional(),
});

export const communityListQuery = listParametersQuery.extend({
	sort: z.enum(['recent', 'rating', 'likes']).default('recent'),
});

export const machineSchema = z.object({
	id: z.string(),
	brand: z.string(),
	model: z.string(),
});

export const materialSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string(),
	commonThicknesses: z.array(z.string()).nullable().optional(),
});

export const parameterStatsSchema = z.object({
	totalParameters: z.number(),
	totalMachines: z.number(),
	totalMaterials: z.number(),
	totalContributors: z.number(),
});

export const rateParameterSchema = z.object({
	rating: z.number().int().min(1).max(5),
});

export const exportQuery = listParametersQuery.extend({
	format: z.enum(['csv', 'pdf']).default('csv'),
});

export type Parameter = z.infer<typeof parameterSchema>;
export type CreateParameter = z.infer<typeof createParameterSchema>;
export type UpdateParameter = z.infer<typeof updateParameterSchema>;
export type ListParametersQuery = z.infer<typeof listParametersQuery>;
export type CommunityListQuery = z.infer<typeof communityListQuery>;
export type RateParameter = z.infer<typeof rateParameterSchema>;
export type ExportQuery = z.infer<typeof exportQuery>;
