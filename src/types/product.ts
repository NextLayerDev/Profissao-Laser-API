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
