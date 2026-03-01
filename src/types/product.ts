import { z } from 'zod';

export const productSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	type: z.string(),
	description: z.string().nullable(),
	image: z.string().nullable(),
	price: z.number(),
	status: z.enum(['ativo', 'excluido', 'inativo']),
	slug: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	language: z.string(),
	country: z.string(),
	category: z.string().nullable(),
	refundDays: z.number().nullable(),
	stripeProductId: z.string().nullable(),
	stripePriceId: z.string().nullable(),
});

export type Product = z.infer<typeof productSchema>;

export const createProductSchema = z.object({
	name: z.string(),
	type: z.string().default('curso'),
	description: z.string().optional(),
	image: z.string().optional(),
	price: z.number().positive(),
	interval: z.enum(['month', 'year', 'one_time']).default('one_time'),
	slug: z.string().optional(),
	language: z.string().default('pt-BR'),
	country: z.string().default('BR'),
	category: z.string().optional(),
	refundDays: z.number().int().positive().default(7),
});

export type ProductCreate = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	category: z.string().optional(),
	price: z.number().positive().optional(),
	refundDays: z.number().int().positive().optional(),
});

export type ProductUpdate = z.infer<typeof updateProductSchema>;

export const updateProductStatusSchema = z.object({
	active: z.boolean(),
});

export type ProductUpdateStatus = z.infer<typeof updateProductStatusSchema>;

export const createdProductResponseSchema = productSchema;

export const productListResponseSchema = z.array(productSchema);

export const courseContentSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	image: z.string().nullable(),
	slug: z.string(),
	modules: z.array(
		z.object({
			id: z.string(),
			title: z.string(),
			description: z.string().nullable(),
			order: z.number(),
			lessons: z.array(
				z.object({
					id: z.string(),
					title: z.string(),
					description: z.string().nullable(),
					videoUrl: z.string().nullable(),
					duration: z.number().nullable(),
					order: z.number(),
					isFree: z.boolean(),
				}),
			),
		}),
	),
});
