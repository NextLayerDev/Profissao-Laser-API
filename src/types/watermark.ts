import { z } from 'zod';

export const customerWatermarkSchema = z.object({
	customerId: z.string(),
	imageUrl: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type CustomerWatermark = z.infer<typeof customerWatermarkSchema>;
