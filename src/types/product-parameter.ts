import { z } from 'zod';
import { lessonSchema } from './lesson.js';
import { createParameterSchema, parameterSchema } from './parameter.js';

// ─── Join entity: produto ↔ máquina ↔ parâmetro ───────────────────────────

export const productParameterSchema = z.object({
	id: z.uuid(),
	productId: z.uuid(),
	machineId: z.uuid(),
	parameterId: z.string(),
	powerOptionId: z.uuid().nullable(),
	lensOptionId: z.uuid().nullable(),
	softwareOptionId: z.uuid().nullable(),
	axisOptionId: z.uuid().nullable(),
	operationOptionId: z.uuid().nullable(),
	variantId: z.uuid().nullable(),
	lessonId: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type ProductParameter = z.infer<typeof productParameterSchema>;

// Associação com parâmetro + vídeo-aula embedded (list/lookup responses)
export const productParameterDetailSchema = productParameterSchema.extend({
	parameter: parameterSchema,
	lesson: lessonSchema.nullable(),
});

export const productParameterListResponseSchema = z.array(
	productParameterDetailSchema,
);

// ─── Create (associar parâmetro existente OU criar novo inline) ───────────

export const createProductParameterSchema = z
	.object({
		machineId: z.uuid(),
		parameterId: z.string().optional(), // associar pl_parameter existente
		parameter: createParameterSchema.optional(), // criar novo inline
		powerOptionId: z.uuid().nullable().optional(),
		lensOptionId: z.uuid().nullable().optional(),
		softwareOptionId: z.uuid().nullable().optional(),
		axisOptionId: z.uuid().nullable().optional(),
		operationOptionId: z.uuid().nullable().optional(),
		// variação opcional: associação variant-level vale só pra ela
		variantId: z.uuid().nullable().optional(),
		lessonId: z.string().nullable().optional(),
	})
	.refine((d) => (d.parameterId ? 1 : 0) + (d.parameter ? 1 : 0) === 1, {
		message: 'Informe parameterId OU parameter (exatamente um)',
	});

export type CreateProductParameterInput = z.infer<
	typeof createProductParameterSchema
>;

// ─── Update ───────────────────────────────────────────────────────────────

export const updateProductParameterSchema = z.object({
	machineId: z.uuid().optional(),
	parameterId: z.string().optional(),
	powerOptionId: z.uuid().nullable().optional(),
	lensOptionId: z.uuid().nullable().optional(),
	softwareOptionId: z.uuid().nullable().optional(),
	axisOptionId: z.uuid().nullable().optional(),
	operationOptionId: z.uuid().nullable().optional(),
	// variantId: null limpa (volta pra product-level), uuid mira a variação
	variantId: z.uuid().nullable().optional(),
	lessonId: z.string().nullable().optional(),
});

export type UpdateProductParameterInput = z.infer<
	typeof updateProductParameterSchema
>;

// ─── Lookup (GET /laser-products/:id/parameter-lookup) ────────────────────

export const parameterLookupQuerySchema = z.object({
	machineId: z.uuid().optional(),
	powerOptionId: z.uuid().optional(),
	lensOptionId: z.uuid().optional(),
	softwareOptionId: z.uuid().optional(),
	axisOptionId: z.uuid().optional(),
	operationOptionId: z.uuid().optional(),
	variantId: z.uuid().optional(),
});

export type ParameterLookupQuery = z.infer<typeof parameterLookupQuerySchema>;

export const parameterLookupResponseSchema = z.object({
	association: productParameterSchema,
	parameter: parameterSchema,
	lesson: lessonSchema.nullable(),
});
