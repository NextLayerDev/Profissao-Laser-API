import { z } from 'zod';

export const supportChatStatusSchema = z.enum([
	'ai',
	'waiting_human',
	'with_human',
	'closed',
]);

export const supportMessageRoleSchema = z.enum([
	'customer',
	'ai',
	'attendant',
	'system',
]);

export const supportMessageSchema = z.object({
	id: z.string(),
	chatId: z.string(),
	role: supportMessageRoleSchema,
	authorId: z.string().nullable().optional(),
	authorName: z.string(),
	content: z.string(),
	fileUrl: z.string().nullable().optional(),
	createdAt: z.string(),
});

export const supportChatSummarySchema = z.object({
	id: z.string(),
	customerId: z.string(),
	customerName: z.string().nullable().optional(),
	attendantId: z.string().nullable().optional(),
	attendantName: z.string().nullable().optional(),
	status: supportChatStatusSchema,
	subject: z.string().nullable().optional(),
	handoffReason: z.string().nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
	closedAt: z.string().nullable().optional(),
	lastMessageAt: z.string().nullable().optional(),
	lastMessageRole: supportMessageRoleSchema.nullable().optional(),
	lastMessagePreview: z.string().nullable().optional(),
});

export const supportChatSchema = supportChatSummarySchema.extend({
	messages: z.array(supportMessageSchema),
});

export const createSupportChatSchema = z.object({
	message: z.string().trim().min(1).max(2000).optional(),
});

export const sendSupportMessageSchema = z.object({
	content: z.string().trim().min(1).max(2000),
});

export const adminListQuerySchema = z.object({
	status: supportChatStatusSchema.optional(),
});

export type SupportChatStatus = z.infer<typeof supportChatStatusSchema>;
export type SupportMessageRole = z.infer<typeof supportMessageRoleSchema>;
export type SupportMessage = z.infer<typeof supportMessageSchema>;
export type SupportChatSummary = z.infer<typeof supportChatSummarySchema>;
export type SupportChat = z.infer<typeof supportChatSchema>;
export type CreateSupportChat = z.infer<typeof createSupportChatSchema>;
export type SendSupportMessage = z.infer<typeof sendSupportMessageSchema>;
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;
