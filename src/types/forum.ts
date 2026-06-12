import { z } from 'zod';

// ─── Categories ───────────────────────────────────────────────────────────────

export const forumCategorySchema = z.object({
	id: z.string(),
	name: z.string(),
	color: z.string(),
	postsCount: z.number(),
});

export const createForumCategorySchema = z.object({
	name: z.string().min(1).max(60),
	/** Opcional: sem cor, o backend sorteia uma da paleta (determinística). */
	color: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color')
		.optional(),
});

export const suggestForumCategorySchema = z.object({
	title: z.string().max(200).optional().default(''),
	content: z.string().min(10).max(5000),
});

export const suggestForumCategoryResponseSchema = z.object({
	category: forumCategorySchema,
	isNew: z.boolean(),
});

export const updateForumCategorySchema = z.object({
	name: z.string().min(1).max(60).optional(),
	color: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color')
		.optional(),
});

export type CreateForumCategory = z.infer<typeof createForumCategorySchema>;
export type UpdateForumCategory = z.infer<typeof updateForumCategorySchema>;

// ─── Replies ──────────────────────────────────────────────────────────────────

export const forumReplySchema = z.object({
	id: z.string(),
	postId: z.string(),
	content: z.string(),
	author: z.string(),
	authorId: z.string(),
	isInstructor: z.boolean(),
	isAccepted: z.boolean(),
	upvotes: z.number(),
	upvotedByMe: z.boolean(),
	createdAt: z.string(),
});

export const createForumReplySchema = z.object({
	content: z.string().min(1).max(5000),
});

export const updateForumReplySchema = z.object({
	content: z.string().min(1).max(5000),
});

export type CreateForumReply = z.infer<typeof createForumReplySchema>;
export type UpdateForumReply = z.infer<typeof updateForumReplySchema>;

// ─── Posts ────────────────────────────────────────────────────────────────────

export const forumPostSchema = z.object({
	id: z.string(),
	title: z.string(),
	content: z.string(),
	author: z.string(),
	authorId: z.string(),
	categoryId: z.string().nullable(),
	categoryName: z.string().nullable(),
	categoryColor: z.string().nullable(),
	upvotes: z.number(),
	upvotedByMe: z.boolean(),
	repliesCount: z.number(),
	acceptedReplyId: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	replies: z.array(forumReplySchema).optional(),
});

export const forumPostsResponseSchema = z.object({
	posts: z.array(forumPostSchema),
	total: z.number(),
	page: z.number(),
	limit: z.number(),
});

export const createForumPostSchema = z.object({
	title: z.string().min(5).max(200),
	content: z.string().min(10).max(10000),
	categoryId: z.string().uuid().optional(),
});

export const updateForumPostSchema = z.object({
	title: z.string().min(5).max(200).optional(),
	content: z.string().min(10).max(10000).optional(),
	categoryId: z.string().uuid().nullable().optional(),
});

export type CreateForumPost = z.infer<typeof createForumPostSchema>;
export type UpdateForumPost = z.infer<typeof updateForumPostSchema>;
