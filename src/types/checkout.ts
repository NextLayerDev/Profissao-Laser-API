import { z } from 'zod';

export const checkoutBodySchema = z.object({
	priceId: z.string().describe('The Stripe Price ID (e.g., price_123...)'),
	successUrl: z.url().describe('URL to redirect to after successful payment'),
	cancelUrl: z.url().describe('URL to redirect to if payment is cancelled'),
});

export const checkoutResponseSchema = z.object({
	url: z.string().nullable(),
	sessionId: z.string(),
});

export type CheckoutBody = z.infer<typeof checkoutBodySchema>;
