import { z } from 'zod';

// === CREATE ===
export const createGlobalPromoLinkSchema = z.object({
	maxRedemptions: z.number().int().min(1),
	discountPercent: z.number().int().min(1).max(100),
	durationMonths: z.number().int().min(1),
	expiresAt: z.string().datetime().optional(),
});

export type CreateGlobalPromoLink = z.infer<typeof createGlobalPromoLinkSchema>;

export const createGlobalPromoLinkResponseSchema = z.object({
	id: z.string().uuid(),
	token: z.string(),
	url: z.string(),
	discountPercent: z.number(),
	durationMonths: z.number(),
	maxRedemptions: z.number(),
	status: z.string(),
	expiresAt: z.string().nullable(),
	createdAt: z.string(),
});

// === INFO (public) ===
export const globalPromoLinkTokenParamsSchema = z.object({
	token: z.string(),
});

export const globalPromoLinkProductSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	description: z.string().nullable(),
	image: z.string().nullable(),
	originalPrice: z.number(),
	discountedPrice: z.number(),
});

export const globalPromoLinkInfoResponseSchema = z.object({
	token: z.string(),
	discountPercent: z.number(),
	durationMonths: z.number(),
	maxRedemptions: z.number(),
	currentRedemptions: z.number(),
	remainingRedemptions: z.number(),
	status: z.string(),
	expiresAt: z.string().nullable(),
	products: z.array(globalPromoLinkProductSchema),
});

// === REDEEM ===
export const redeemGlobalPromoLinkSchema = z.object({
	productId: z.uuid(),
	customerName: z.string().min(2),
	customerPhone: z.string().min(10),
	customerCpf: z.string().min(11).max(14),
	email: z.email(),
	password: z.string().min(6),
	companyName: z.string().min(1),
});

export type RedeemGlobalPromoLink = z.infer<typeof redeemGlobalPromoLinkSchema>;

export const redeemGlobalPromoLinkResponseSchema = z.object({
	checkoutUrl: z.string(),
	sessionId: z.string(),
});

// === STATUS UPDATE ===
export const globalPromoLinkIdParamsSchema = z.object({
	id: z.string().uuid(),
});

export const updateGlobalPromoLinkStatusSchema = z.object({
	status: z.enum(['active', 'inactive']),
});

export type UpdateGlobalPromoLinkStatus = z.infer<
	typeof updateGlobalPromoLinkStatusSchema
>;

export const updateGlobalPromoLinkStatusResponseSchema = z.object({
	id: z.string().uuid(),
	status: z.string(),
	updatedAt: z.string(),
});

// === LISTING ===
export const globalPromoLinkListItemSchema = z.object({
	id: z.string().uuid(),
	token: z.string(),
	discountPercent: z.number(),
	durationMonths: z.number(),
	maxRedemptions: z.number(),
	currentRedemptions: z.number(),
	status: z.string(),
	expiresAt: z.string().nullable(),
	createdBy: z.string().nullable(),
	createdAt: z.string(),
});
