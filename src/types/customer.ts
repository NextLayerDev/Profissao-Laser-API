import { z } from 'zod';

export const customerSchema = z.object({
	id: z.string(),
	email: z.email(),
	stripe: z.string(),
	access: z.string(),
	name: z.string().min(2),
	password: z.string().min(6),
	role: z.string().optional(),
});

export type Customer = z.infer<typeof customerSchema>;
export type CustomerUpdate = Partial<Customer>;
