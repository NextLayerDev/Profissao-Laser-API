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

// ─── Parâmetros do motor Potrace (porte do site_nextlayer) ───────────
// Presets de qualidade (front): rapido / detalhado / svg → resolvem estes
// campos. `mode` é o algoritmo Potrace (trace ou posterize).
export const vectorizeParamsSchema = z.object({
	// Preset de qualidade (rótulo p/ histórico; o front já envia os campos resolvidos)
	preset: z.enum(['rapido', 'detalhado', 'svg']).optional(),
	// Potrace base
	turdSize: z.number().default(5),
	optTolerance: z.number().default(0.2),
	alphaMax: z.number().default(1),
	drawingStyle: z.enum(['fill', 'stroke', 'outline']).default('fill'),
	color: z.string().default('#000000'),
	strokeWidth: z.number().default(1),
	nonScalingStroke: z.boolean().default(false),
	// Pré-processamento
	threshold: z.number().int().min(0).max(255).default(128),
	invert: z.boolean().default(false),
	blur: z.number().nullable().default(null),
	sharpen: z.boolean().default(false),
	brightness: z.number().nullable().default(null),
	contrast: z.number().nullable().default(null),
	gamma: z.number().nullable().default(null),
	// Potrace expostos
	turnPolicy: z
		.enum(['black', 'white', 'left', 'right', 'minority', 'majority'])
		.nullable()
		.default(null),
	blackOnWhite: z.boolean().default(true),
	// Posterize
	mode: z.enum(['trace', 'posterize']).default('trace'),
	posterizeLevels: z.number().int().min(2).max(10).default(4),
	posterizeFillStrategy: z
		.enum(['dominant', 'mean', 'median', 'spread'])
		.default('dominant'),
	posterizeRangeDistribution: z.enum(['auto', 'equal']).default('auto'),
	// Dithering
	ditherAlgorithm: z
		.enum([
			'floydSteinberg',
			'atkinson',
			'stucki',
			'jarvis',
			'sierra',
			'ordered',
			'halftone',
		])
		.nullable()
		.default(null),
	// Padrões de linha
	linePattern: z
		.enum([
			'none',
			'horizontal',
			'vertical',
			'diagonal45',
			'diagonal135',
			'crosshatch',
			'diamondHatch',
		])
		.default('none'),
	lineSpacing: z.number().default(3),
	lineAngle: z.number().nullable().default(null),
	// Saída / dimensões
	dpi: z.number().int().nullable().default(null),
	outputWidth: z.number().nullable().default(null),
	outputHeight: z.number().nullable().default(null),
	svgOptimize: z.boolean().default(false),
	// Detecção de bordas
	edgeDetection: z.enum(['none', 'sobel', 'canny']).default('none'),
});

export const vectorizeResultSchema = vectorSchema.extend({
	// Inline para o front pré-visualizar/baixar sem nova requisição
	svgContent: z.string(),
	originalName: z.string(),
	isColor: z.boolean(),
	svgUrl: z.string().optional(),
	pngUrl: z.string().optional(),
	dxfContent: z.string().optional(),
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
