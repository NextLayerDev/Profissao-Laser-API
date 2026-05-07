import { z } from 'zod';

export const knowledgeBaseArticleSchema = z.object({
	id: z.string(),
	title: z.string(),
	type: z.enum(['article', 'video']),
	content: z.string().nullable().optional(),
	excerpt: z.string().nullable().optional(),
	videoUrl: z.string().nullable().optional(),
	readTime: z.number().nullable().optional(),
	icon: z.string().nullable().optional(),
	category: z.string().nullable().optional(),
	isPublished: z.boolean(),
	order: z.number(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const createKnowledgeBaseSchema = z.object({
	title: z.string().min(1),
	type: z.enum(['article', 'video']),
	content: z.string().optional(),
	excerpt: z.string().optional(),
	videoUrl: z.string().optional(),
	readTime: z.number().int().optional(),
	icon: z.string().optional(),
	category: z.string().optional(),
	isPublished: z.boolean().default(true),
	order: z.number().int().default(0),
});

export const updateKnowledgeBaseSchema = createKnowledgeBaseSchema.partial();

export const listKnowledgeBaseQuery = z.object({
	category: z.string().optional(),
	type: z.enum(['article', 'video']).optional(),
	search: z.string().optional(),
});

export type KnowledgeBaseArticle = z.infer<typeof knowledgeBaseArticleSchema>;
export type CreateKnowledgeBase = z.infer<typeof createKnowledgeBaseSchema>;
export type UpdateKnowledgeBase = z.infer<typeof updateKnowledgeBaseSchema>;
export type ListKnowledgeBaseQuery = z.infer<typeof listKnowledgeBaseQuery>;
