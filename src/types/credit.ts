import { z } from 'zod';

export const CREDIT_FEATURES = ['previa', 'vectorize', 'editor-ai'] as const;
export type CreditFeature = (typeof CREDIT_FEATURES)[number];

export const creditBalanceSchema = z.object({ balance: z.number().int() });

export const creditPackageSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	credits: z.number().int(),
	price: z.number(),
	status: z.enum(['ativo', 'inativo']),
});
export const creditPackageListSchema = z.array(creditPackageSchema);

export const creditCostSchema = z.object({
	feature: z.string(),
	cost: z.number().int(),
	label: z.string(),
});
export const creditCostListSchema = z.array(creditCostSchema);

export const createCheckoutSchema = z.object({ packageId: z.string() });
export const checkoutResponseSchema = z.object({
	checkoutUrl: z.string(),
	sessionId: z.string(),
});

export const createPackageSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	credits: z.number().int().positive(),
	price: z.number().positive(),
});
export const updatePackageSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	credits: z.number().int().positive().optional(),
	price: z.number().positive().optional(),
});
export const updatePackageStatusSchema = z.object({ active: z.boolean() });

export const updateCostSchema = z.object({ cost: z.number().int().positive() });

export const adjustCreditsSchema = z.object({
	customerId: z.string(),
	amount: z.number().int(),
	reason: z.string().min(1),
});

export const creditHistoryQuerySchema = z.object({
	page: z.coerce.number().int().positive().default(1),
	limit: z.coerce.number().int().positive().max(100).default(20),
});
export const creditTransactionSchema = z.object({
	id: z.string(),
	type: z.enum(['purchase', 'debit', 'refund', 'adjustment']),
	amount: z.number().int(),
	balanceAfter: z.number().int(),
	feature: z.string().nullable(),
	createdAt: z.string(),
});
export const creditHistoryResponseSchema = z.object({
	data: z.array(creditTransactionSchema),
	total: z.number().int(),
	page: z.number().int(),
	limit: z.number().int(),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;
export type CreatePackageInput = z.infer<typeof createPackageSchema>;
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;
export type AdjustCreditsInput = z.infer<typeof adjustCreditsSchema>;
