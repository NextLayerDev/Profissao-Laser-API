import { z } from 'zod';

export const userSchema = z.object({
	id: z.string(),
	name: z.string().min(2),
	email: z.email(),
	role: z.string().optional(),
	Permissions: z.number().nullable(),
	created_at: z.string().optional(),
});

export const userUpdateSchema = userSchema
	.omit({ id: true, created_at: true })
	.partial();

export type User = z.infer<typeof userSchema>;
export type UserUpdate = z.infer<typeof userUpdateSchema>;
