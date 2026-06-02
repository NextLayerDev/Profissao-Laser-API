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
	// 9. Frequência (kHz)
	frequency: z.number(),
	// 10. Linha (mm)
	line: z.number().nullable().optional(),
	// 11. Preenchimento Cruzado — liga/desliga
	crossHatch: z.boolean(),
	// 12. Ângulo (°)
	angle: z.number().nullable().optional(),
	// 13. Passadas (Contorno)
	passes: z.number(),
	// 14. Passadas (Preenchimento)
	passesFill: z.number().nullable().optional(),
	// Desfoque (mm, -20 a +20 — negativo = pra baixo, positivo = pra cima)
	defocus: z.number().nullable().optional(),
	// Gás — caixa liga/desliga
	gas: z.boolean(),
	// Q-pulse (UV) — largura/frequência do pulso Q-switch (recipe)
	qPulse: z.number().nullable().optional(),
	// Software-specific (Ezcad: tamanhoDivisao + sobreposicao; Lightburn: tamanhoLinha + forcarSeparacao)
	tamanhoLinha: z.number().nullable().optional(),
	tamanhoDivisao: z.number().nullable().optional(),
	sobreposicao: z.number().nullable().optional(),
	forcarSeparacao: z.boolean().nullable().optional(),
	axisRotative: z.boolean().nullable().optional(),
	lineTypeId: z.string().nullable().optional(),
	// 15. Notas
	notes: z.string().nullable().optional(),
	// Imagem + categoria (redesign da página)
	imageUrl: z.string().nullable().optional(),
	category: z.string().nullable().optional(),
	// Cor (nova dimensão de filtro/metadado)
	color: z.string().nullable().optional(),
	// Multi-passada: parâmetro "pai" com N passadas (cada passada = um parâmetro).
	parentId: z.string().nullable().optional(),
	passOrder: z.number().nullable().optional(),
	isParent: z.boolean().optional(),
	passCount: z.number().optional(),
	// Legado — fora do formulário novo, mantidos opcionais
	materialType: z.string().nullable().optional(),
	thickness: z.string().nullable().optional(),
	// Meta + social
	createdBy: z.string(),
	createdByName: z.string().nullable().optional(),
	isPublic: z.boolean(),
	// Workflow de revisão (envio do membro): pending → approved/rejected.
	status: z.enum(['pending', 'approved', 'rejected']).optional(),
	reviewNote: z.string().nullable().optional(),
	reviewedBy: z.string().nullable().optional(),
	reviewedAt: z.string().nullable().optional(),
	submittedBy: z.string().nullable().optional(),
	rating: z.number().nullable().optional(),
	likesCount: z.number().optional(),
	savesCount: z.number().optional(),
	isSaved: z.boolean().optional(),
	isLiked: z.boolean().optional(),
	userRating: z.number().nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

/** Recipe de UMA passada (sem metadados — material/imagem/categoria vêm do pai). */
export const passRecipeSchema = z.object({
	// Herdados do parâmetro pai (máquina/lente/software/modo/potência-W são o
	// mesmo setup para todas as passadas). Opcionais: o repositório sempre
	// sobrescreve estes campos com os valores do pai ao persistir as filhas.
	machine: z.string().min(1).optional(),
	powerWatts: z.number().int().min(0).optional(),
	lens: z.string().min(1).optional(),
	software: z.string().min(1).optional(),
	mode: z.string().min(1).optional(),
	speed: z.number().int().min(0),
	power: z.number().int().min(0).max(100),
	frequency: z.number().int().min(0),
	line: z.number().min(0),
	crossHatch: z.boolean().default(false),
	angle: z.number().int().min(0).max(360),
	passes: z.number().int().min(1).default(1),
	passesFill: z.number().int().min(1).default(1),
	defocus: z.number().int().min(-20).max(20).nullable().optional(),
	gas: z.boolean().default(false),
	qPulse: z.number().nullable().optional(),
	tamanhoLinha: z.number().nullable().optional(),
	tamanhoDivisao: z.number().nullable().optional(),
	sobreposicao: z.number().nullable().optional(),
	forcarSeparacao: z.boolean().nullable().optional(),
	axisRotative: z.boolean().nullable().optional(),
	lineTypeId: z.string().uuid().nullable().optional(),
	notes: z.string().nullable().optional(),
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
	// 9. Frequência (kHz) *
	frequency: z.number().int().min(0),
	// 10. Linha (mm) *
	line: z.number().min(0),
	// 11. Preenchimento Cruzado — caixa liga/desliga
	crossHatch: z.boolean().default(false),
	// 12. Ângulo (°) *
	angle: z.number().int().min(0).max(360),
	// 13. Passadas (Contorno) *
	passes: z.number().int().min(1).default(1),
	// 14. Passadas (Preenchimento) *
	passesFill: z.number().int().min(1).default(1),
	// 15. Notas
	notes: z.string().nullable().optional(),
	// Desfoque (mm, -20 a +20: negativo = pra baixo, positivo = pra cima) — opcional
	defocus: z.number().int().min(-20).max(20).nullable().optional(),
	// Gás — caixa liga/desliga
	gas: z.boolean().default(false),
	// Q-pulse (UV) — recipe
	qPulse: z.number().nullable().optional(),
	// Software-specific opcionais
	tamanhoLinha: z.number().nullable().optional(), // Lightburn
	tamanhoDivisao: z.number().nullable().optional(), // Ezcad
	sobreposicao: z.number().nullable().optional(), // Ezcad
	forcarSeparacao: z.boolean().nullable().optional(), // Lightburn
	axisRotative: z.boolean().nullable().optional(),
	lineTypeId: z.string().uuid().nullable().optional(),
	// Legado — fora do formulário novo, agora opcionais
	materialType: z.string().nullable().optional(),
	thickness: z.string().nullable().optional(),
	// Público (visível para alunos)
	isPublic: z.boolean().default(false),
	// Imagem (URL no storage) + categoria (Copos/Metais/Madeira/Acrílico/Brindes/Outros)
	imageUrl: z.string().nullable().optional(),
	category: z.string().nullable().optional(),
	// Cor (nova dimensão)
	color: z.string().nullable().optional(),
	// Multi-passada: passadas extras (2..N). A passada 1 é o recipe principal acima.
	extraPasses: z.array(passRecipeSchema).optional(),
});

export const updateParameterSchema = createParameterSchema.partial();

/** Parâmetro + suas passadas (pai = passada 1, depois os filhos em ordem). */
export const parameterWithPassesSchema = parameterSchema.extend({
	passes: z.array(parameterSchema),
});

/** Dados da sidebar da página de parâmetros (redesign). */
export const parameterSidebarSchema = z.object({
	topContributors: z.array(
		z.object({
			createdBy: z.string(),
			name: z.string().nullable(),
			count: z.number(),
		}),
	),
	recentActivity: z.array(
		z.object({
			id: z.string(),
			material: z.string(),
			createdByName: z.string().nullable(),
			createdAt: z.string(),
		}),
	),
	mostUsed: z.array(
		z.object({
			id: z.string(),
			material: z.string(),
			imageUrl: z.string().nullable(),
			likesCount: z.number(),
		}),
	),
});

export const listParametersQuery = z.object({
	page: z.coerce.number().int().positive().default(1),
	limit: z.coerce.number().int().positive().max(100).default(20),
	machine: z.string().optional(),
	model: z.string().optional(),
	material: z.string().optional(),
	thickness: z.string().optional(),
	search: z.string().optional(),
	mode: z.string().optional(),
	software: z.string().optional(),
	category: z.string().optional(),
	lens: z.string().optional(),
	color: z.string().optional(),
});

export const communityListQuery = listParametersQuery.extend({
	// 'relevant' = salvos do cliente primeiro, depois mais curtidos
	sort: z.enum(['recent', 'rating', 'likes', 'relevant']).default('recent'),
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

/** Dimensões de filtro com vocabulário gerido pelo admin. */
export const parameterOptionDimension = z.enum([
	'lens',
	'category',
	'color',
	'mode',
]);

export const parameterOptionSchema = z.object({
	id: z.string(),
	dimension: parameterOptionDimension,
	value: z.string(),
	order: z.number(),
	status: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const createParameterOptionSchema = z.object({
	dimension: parameterOptionDimension,
	value: z.string().min(1),
	order: z.number().int().default(0),
});

export const updateParameterOptionSchema = z.object({
	value: z.string().min(1).optional(),
	order: z.number().int().optional(),
	status: z.enum(['ativo', 'inativo']).optional(),
});

/** Revisão de um envio de membro: aprovar (publica) ou rejeitar. */
export const reviewParameterSchema = z.object({
	action: z.enum(['approve', 'reject']),
	reviewNote: z.string().optional(),
});

export type Parameter = z.infer<typeof parameterSchema>;
export type PassRecipe = z.infer<typeof passRecipeSchema>;
export type ParameterWithPasses = z.infer<typeof parameterWithPassesSchema>;
export type ParameterSidebar = z.infer<typeof parameterSidebarSchema>;
export type CreateParameter = z.infer<typeof createParameterSchema>;
export type UpdateParameter = z.infer<typeof updateParameterSchema>;
export type ListParametersQuery = z.infer<typeof listParametersQuery>;
export type CommunityListQuery = z.infer<typeof communityListQuery>;
export type RateParameter = z.infer<typeof rateParameterSchema>;
export type ExportQuery = z.infer<typeof exportQuery>;
export type ParameterOption = z.infer<typeof parameterOptionSchema>;
export type CreateParameterOption = z.infer<typeof createParameterOptionSchema>;
export type UpdateParameterOption = z.infer<typeof updateParameterOptionSchema>;
export type ReviewParameter = z.infer<typeof reviewParameterSchema>;
