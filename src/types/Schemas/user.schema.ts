import { z } from 'zod';

export const UserSchema = z.object({
	id: z.string().optional(),
	name: z.string().min(2),
	email: z.email(),
	password: z.string().min(6).optional(),
	role: z.string().optional(),
});

export const UpdateUserSchema = UserSchema.partial();
