import { z } from 'zod';

export const parameterSchema = z.object({
	id: z.string(),
	// 1. Máquina
	machine: z.string().nullable().optional(),
	// 2. Potência (W)
	powerWatts: z.number().nullable().optional(),
	// 3. Lente (mm)
	lens: z.string().nullable().optional(),
	// 4. Software
	software: z.string().nullable().optional(),
	// 5. Produto/Material
	material: z.string(),
	// 6. Tipo do Trabalho
	mode: z.string(),
	// 7. Velocidade (mm/s)
	speed: z.number(),
	// 8. Potência (%)
	power: z.number(),
	// 9. Frequência (Hz)
	frequency: z.number(),
	// 10. Linha (mm)
	line: z.number().nullable().optional(),
	// 11. Preenchimento Cruzado (%)
	crossHatch: z.number().nullable().optional(),
	// 12. Ângulo (°)
	angle: z.number().nullable().optional(),
	// 13. Passadas (Contorno)
	passes: z.number(),
	// 14. Passadas (Preenchimento)
	passesFill: z.number().nullable().optional(),
	// Desfoque (mm, 0-20)
	defocus: z.number().nullable().optional(),
	// Gás — caixa liga/desliga
	gas: z.boolean(),
	// 15. Notas
	notes: z.string().nullable().optional(),
	// Legado — fora do formulário novo, mantidos opcionais
	materialType: z.string().nullable().optional(),
	thickness: z.string().nullable().optional(),
	// Meta + social
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
	// 1. Máquina *
	machine: z.string().min(1),
	// 2. Potência (W) *
	powerWatts: z.number().int().min(0),
	// 3. Lente (mm) *
	lens: z.string().min(1),
	// 4. Software *
	software: z.string().min(1),
	// 5. Produto/Material *
	material: z.string().min(1),
	// 6. Tipo do Trabalho *
	mode: z.string().min(1),
	// 7. Velocidade (mm/s) *
	speed: z.number().int().min(0),
	// 8. Potência (%) *
	power: z.number().int().min(0).max(100),
	// 9. Frequência (Hz) *
	frequency: z.number().int().min(0),
	// 10. Linha (mm) *
	line: z.number().min(0),
	// 11. Preenchimento Cruzado (%) *
	crossHatch: z.number().int().min(0).max(100),
	// 12. Ângulo (°) *
	angle: z.number().int().min(0).max(360),
	// 13. Passadas (Contorno) *
	passes: z.number().int().min(1).default(1),
	// 14. Passadas (Preenchimento) *
	passesFill: z.number().int().min(1).default(1),
	// 15. Notas
	notes: z.string().nullable().optional(),
	// Desfoque (mm, 0-20) — opcional
	defocus: z.number().int().min(0).max(20).nullable().optional(),
	// Gás — caixa liga/desliga
	gas: z.boolean().default(false),
	// Legado — fora do formulário novo, agora opcionais
	materialType: z.string().nullable().optional(),
	thickness: z.string().nullable().optional(),
	// Público (visível para alunos)
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
