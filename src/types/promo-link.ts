import { z } from 'zod';

// === CREATE ===
export const createPromoLinkSchema = z.object({
	productId: z.uuid(),
	maxRedemptions: z.number().int().min(1),
	discountPercent: z.number().int().min(1).max(100),
	durationMonths: z.number().int().min(1),
	expiresAt: z.string().datetime().optional(),
});

export type CreatePromoLink = z.infer<typeof createPromoLinkSchema>;

export const createPromoLinkResponseSchema = z.object({
	id: z.string().uuid(),
	token: z.string(),
	url: z.string(),
	productName: z.string(),
	discountPercent: z.number(),
	durationMonths: z.number(),
	maxRedemptions: z.number(),
	status: z.string(),
	expiresAt: z.string().nullable(),
	createdAt: z.string(),
});

// === INFO (public) ===
export const promoLinkTokenParamsSchema = z.object({
	token: z.string(),
});

export const promoLinkInfoResponseSchema = z.object({
	token: z.string(),
	productName: z.string(),
	productDescription: z.string().nullable(),
	originalPrice: z.number(),
	discountedPrice: z.number(),
	discountPercent: z.number(),
	durationMonths: z.number(),
	maxRedemptions: z.number(),
	currentRedemptions: z.number(),
	remainingRedemptions: z.number(),
	status: z.string(),
	expiresAt: z.string().nullable(),
});

// === REDEEM ===
export const redeemPromoLinkSchema = z.object({
	customerName: z.string().min(2),
	customerPhone: z.string().min(10),
	customerCpf: z.string().min(11).max(14),
	email: z.email(),
	password: z.string().min(6),
	companyName: z.string().min(1),
});

export type RedeemPromoLink = z.infer<typeof redeemPromoLinkSchema>;

export const redeemPromoLinkResponseSchema = z.object({
	checkoutUrl: z.string(),
	sessionId: z.string(),
});

// === STATUS UPDATE ===
export const promoLinkIdParamsSchema = z.object({
	id: z.string().uuid(),
});

export const updatePromoLinkStatusSchema = z.object({
	status: z.enum(['active', 'inactive']),
});

export type UpdatePromoLinkStatus = z.infer<typeof updatePromoLinkStatusSchema>;

export const updatePromoLinkStatusResponseSchema = z.object({
	id: z.string().uuid(),
	status: z.string(),
	updatedAt: z.string(),
});

// === LISTING ===
export const promoLinkListItemSchema = z.object({
	id: z.string().uuid(),
	token: z.string(),
	productName: z.string(),
	discountPercent: z.number(),
	durationMonths: z.number(),
	maxRedemptions: z.number(),
	currentRedemptions: z.number(),
	status: z.string(),
	expiresAt: z.string().nullable(),
	createdBy: z.string().nullable(),
	createdAt: z.string(),
});
