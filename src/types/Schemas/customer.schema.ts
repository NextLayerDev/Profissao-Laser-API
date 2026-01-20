import { z } from 'zod';

export const CustomerSchema = z.object({
	id: z.string().optional(),
	email: z.email(),
	name: z.string().min(2),
	stripe: z.string(),
	access: z.string(),
	password: z.string().min(6).optional(),
	role: z.string().optional(),
});

export const UpdateCustomerSchema = CustomerSchema.partial();
