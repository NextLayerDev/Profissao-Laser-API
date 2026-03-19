import { z } from 'zod';

export const createPaymentLinkSchema = z.object({
	productId: z.uuid(),
	customerName: z.string().min(2),
	customerPhone: z.string().min(10),
	customerCpf: z.string().min(11).max(14),
	companyName: z.string().min(1),
	expiresAt: z.string().datetime().optional(),
});

export type CreatePaymentLink = z.infer<typeof createPaymentLinkSchema>;

export const createPaymentLinkResponseSchema = z.object({
	id: z.string().uuid(),
	token: z.string(),
	url: z.string(),
	productName: z.string(),
	customerName: z.string(),
	status: z.string(),
	expiresAt: z.string().nullable(),
	createdAt: z.string(),
});

export const paymentLinkInfoResponseSchema = z.object({
	token: z.string(),
	productName: z.string(),
	productDescription: z.string().nullable(),
	originalPrice: z.number(),
	discountedPrice: z.number(),
	discountPercent: z.number(),
	customerName: z.string(),
	companyName: z.string(),
	status: z.string(),
	expiresAt: z.string().nullable(),
});

export const redeemPaymentLinkSchema = z.object({
	customerName: z.string().min(2),
	customerPhone: z.string().min(10),
	customerCpf: z.string().min(11).max(14),
	email: z.email(),
	password: z.string().min(6),
	companyName: z.string().min(1),
});

export type RedeemPaymentLink = z.infer<typeof redeemPaymentLinkSchema>;

export const redeemPaymentLinkResponseSchema = z.object({
	checkoutUrl: z.string(),
	sessionId: z.string(),
});

export const paymentLinkTokenParamsSchema = z.object({
	token: z.string(),
});
