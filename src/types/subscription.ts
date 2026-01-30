import { z } from 'zod';

export const subscriptionSchema = z.object({
	id: z.uuid(),
	userId: z.uuid(),
	planId: z.uuid(),
	status: z.enum(['active', 'inactive']),
	createdAt: z.date(),
	updatedAt: z.date().nullable(),
});

export type Subscription = z.infer<typeof subscriptionSchema>;
