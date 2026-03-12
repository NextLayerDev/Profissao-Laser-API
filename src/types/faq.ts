import { z } from 'zod';

export const createFaqSchema = z.object({
	question: z.string(),
	answer: z.string(),
	imageUrl: z.string().optional(),
	order: z.number().int(),
});

export const updateFaqSchema = z.object({
	question: z.string().optional(),
	answer: z.string().optional(),
	imageUrl: z.string().nullable().optional(),
	order: z.number().int().optional(),
});

export const reorderFaqSchema = z.object({
	ids: z.array(z.string()),
});

export const reactFaqSchema = z.object({
	emoji: z.enum(['👍', '❤️', '🔥', '💡', '👏']),
});

export const faqReactionSchema = z.object({
	emoji: z.string(),
	count: z.number(),
});

export const faqSchema = z.object({
	id: z.string(),
	question: z.string(),
	answer: z.string(),
	image_url: z.string().nullable(),
	order: z.number(),
	created_at: z.string(),
	updated_at: z.string(),
	reactions: z.array(faqReactionSchema),
	userReaction: z.string().nullable(),
});

export type CreateFaq = z.infer<typeof createFaqSchema>;
export type UpdateFaq = z.infer<typeof updateFaqSchema>;
export type ReorderFaq = z.infer<typeof reorderFaqSchema>;
export type ReactFaq = z.infer<typeof reactFaqSchema>;
