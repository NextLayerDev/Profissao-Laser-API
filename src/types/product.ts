import { z } from 'zod';

export const productSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	image: z.string().nullable(),
	prices: z.object({
		monthly: z.number().nullable(),
		annual: z.number().nullable(),
		lifetime: z.number().nullable(),
	}),
	currency: z.string(),
});

export const productIdsResponseSchema = z.array(z.string());

export const catalogProductSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	stripe_product_id: z.string(),
	stripe_price_ids: z.array(z.string()),
	created_at: z.string(),
});

export const catalogProductsResponseSchema = z.array(catalogProductSchema);

export const createProductSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	prices: z.array(
		z.object({
			amount: z.number().int().positive(),
			interval: z.enum(['month', 'year', 'one_time']),
		}),
	),
});

export const createdProductResponseSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().optional().nullable(),
	stripe_product_id: z.string(),
	stripe_price_ids: z.array(z.string()),
});

export type Product = {
	id: string;
	name: string;
	description?: string;
	stripe_product_id: string;
	stripe_price_ids: string[]; // Changed to array
};
