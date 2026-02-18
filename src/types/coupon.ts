import { z } from 'zod';

export const createCouponSchema = z.object({
	product_id: z.string(),
	percent_off: z.number().min(1).max(100).optional(),
	amount_off: z.number().int().positive().optional(),
	duration: z.enum(['once', 'repeating', 'forever']),
	duration_in_months: z.number().int().positive().optional(),
	max_redemptions: z.number().int().positive().optional(),
	redeem_by: z.string().datetime().optional(),
});

export const couponResponseSchema = z.object({
	id: z.string(),
	percent_off: z.number().nullable(),
	amount_off: z.number().nullable(),
	currency: z.string().nullable(),
	duration: z.string(),
	duration_in_months: z.number().nullable(),
	max_redemptions: z.number().nullable(),
	redeem_by: z.number().nullable(),
	product_id: z.string(),
});

export const couponSchema = z.object({
	id: z.string(),
	percent_off: z.number().nullable(),
	amount_off: z.number().nullable(),
	currency: z.string().nullable(),
	duration: z.string(),
	duration_in_months: z.number().nullable(),
	max_redemptions: z.number().nullable(),
	redeem_by: z.number().nullable(),
	times_redeemed: z.number(),
	valid: z.boolean(),
	product_id: z.string(),
});

export const deleteCouponResponseSchema = z.object({
	id: z.string(),
	deleted: z.boolean(),
});
