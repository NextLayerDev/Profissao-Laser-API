import { z } from 'zod';

export const doubtReplySchema = z.object({
	id: z.string(),
	content: z.string(),
	authorName: z.string(),
	createdAt: z.string(),
	isInstructor: z.literal(true),
});

export const doubtSchema = z.object({
	id: z.string(),
	content: z.string(),
	authorName: z.string(),
	createdAt: z.string(),
	replies: z.array(doubtReplySchema),
});

export const createDoubtSchema = z.object({
	content: z.string().min(1),
});

export const createReplySchema = z.object({
	content: z.string().min(1),
});

export type Doubt = z.infer<typeof doubtSchema>;
export type DoubtReply = z.infer<typeof doubtReplySchema>;
export type CreateDoubt = z.infer<typeof createDoubtSchema>;
export type CreateReply = z.infer<typeof createReplySchema>;

// --- Visão agregada do admin (central de pendências / aba Suporte) ---

export const adminDoubtSchema = z.object({
	id: z.string(),
	lessonId: z.string(),
	customerId: z.string().nullable(),
	content: z.string(),
	authorName: z.string(),
	createdAt: z.string(),
	repliesCount: z.number(),
	lastReplyAt: z.string().nullable(),
	answered: z.boolean(),
});

export const adminDoubtsResponseSchema = z.object({
	doubts: z.array(adminDoubtSchema),
	total: z.number(),
	unansweredCount: z.number(),
});

export type AdminDoubt = z.infer<typeof adminDoubtSchema>;
export type AdminDoubtsStatus = 'unanswered' | 'answered' | 'all';
