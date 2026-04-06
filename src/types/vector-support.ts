import { z } from 'zod';

// ── Files ────────────────────────────────────────────────────────────────────

export const vectorSupportFileSchema = z.object({
	id: z.string(),
	messageId: z.string(),
	fileUrl: z.string(),
	fileName: z.string(),
	fileType: z.string(),
	createdAt: z.string(),
});

// ── Messages ─────────────────────────────────────────────────────────────────

export const vectorSupportMessageSchema = z.object({
	id: z.string(),
	ticketId: z.string(),
	authorId: z.string(),
	authorName: z.string(),
	isTechnician: z.boolean(),
	content: z.string().nullable(),
	files: z.array(vectorSupportFileSchema),
	createdAt: z.string(),
});

// ── Tickets ──────────────────────────────────────────────────────────────────

export const vectorSupportTicketSummarySchema = z.object({
	id: z.string(),
	customerId: z.string(),
	customerName: z.string(),
	status: z.string(),
	subject: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const vectorSupportTicketSchema =
	vectorSupportTicketSummarySchema.extend({
		messages: z.array(vectorSupportMessageSchema),
	});

// ── Input schemas ────────────────────────────────────────────────────────────

export const createTicketSchema = z.object({
	subject: z.string().min(1),
	initialMessage: z.string().min(1).optional(),
});

export const sendVectorSupportMessageSchema = z.object({
	content: z.string().min(1).optional(),
});

// ── Types ────────────────────────────────────────────────────────────────────

export type VectorSupportFile = z.infer<typeof vectorSupportFileSchema>;
export type VectorSupportMessage = z.infer<typeof vectorSupportMessageSchema>;
export type VectorSupportTicketSummary = z.infer<
	typeof vectorSupportTicketSummarySchema
>;
export type VectorSupportTicket = z.infer<typeof vectorSupportTicketSchema>;
export type CreateTicket = z.infer<typeof createTicketSchema>;
export type SendVectorSupportMessage = z.infer<
	typeof sendVectorSupportMessageSchema
>;
