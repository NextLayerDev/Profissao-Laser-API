import { z } from 'zod';

export const doubtCategorySchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string().nullable().optional(),
	order: z.number(),
});

export const createDoubtCategorySchema = z.object({
	title: z.string().min(1),
	description: z.string().optional(),
	order: z.number().optional(),
});

export const updateDoubtCategorySchema = createDoubtCategorySchema.partial();

export const reorderSchema = z.object({
	ids: z.array(z.string()),
});

export const technicianSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
});

export const defaultQuestionSchema = z.object({
	id: z.string(),
	text: z.string(),
	type: z.enum(['text', 'textarea', 'select']),
	options: z.array(z.string()).nullable().optional(),
	order: z.number(),
});

export const createDefaultQuestionSchema = z.object({
	text: z.string().min(1),
	type: z.enum(['text', 'textarea', 'select']),
	options: z.array(z.string()).optional(),
	order: z.number().optional(),
});

export const updateDefaultQuestionSchema =
	createDefaultQuestionSchema.partial();

export const chatMessageSchema = z.object({
	id: z.string(),
	content: z.string(),
	fileUrl: z.string().nullable().optional(),
	authorId: z.string(),
	authorName: z.string(),
	isTechnician: z.boolean(),
	createdAt: z.string(),
});

export const doubtChatSummarySchema = z.object({
	id: z.string(),
	categoryId: z.string(),
	categoryName: z.string().nullable().optional(),
	technicianId: z.string().nullable().optional(),
	technicianName: z.string().nullable().optional(),
	customerId: z.string(),
	customerName: z.string().nullable().optional(),
	status: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const doubtChatSchema = doubtChatSummarySchema.extend({
	messages: z.array(chatMessageSchema),
});

export const createChatSchema = z.object({
	categoryId: z.string(),
	technicianId: z.string().optional(),
	qualificationAnswers: z.record(z.string(), z.string()).optional(),
	initialMessage: z.string().min(1).optional(),
});

export const sendChatMessageSchema = z.object({
	content: z.string().min(1).optional(),
});

export type DoubtCategory = z.infer<typeof doubtCategorySchema>;
export type CreateDoubtCategory = z.infer<typeof createDoubtCategorySchema>;
export type UpdateDoubtCategory = z.infer<typeof updateDoubtCategorySchema>;
export type Reorder = z.infer<typeof reorderSchema>;
export type Technician = z.infer<typeof technicianSchema>;
export type DefaultQuestion = z.infer<typeof defaultQuestionSchema>;
export type CreateDefaultQuestion = z.infer<typeof createDefaultQuestionSchema>;
export type UpdateDefaultQuestion = z.infer<typeof updateDefaultQuestionSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type DoubtChatSummary = z.infer<typeof doubtChatSummarySchema>;
export type DoubtChat = z.infer<typeof doubtChatSchema>;
export type CreateChat = z.infer<typeof createChatSchema>;
export type SendChatMessage = z.infer<typeof sendChatMessageSchema>;
