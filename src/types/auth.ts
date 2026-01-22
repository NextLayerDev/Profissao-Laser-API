import { z } from 'zod';

export const loginSchema = z.object({
	email: z.email('Invalid email'),
	password: z.string().min(6, 'Password must be at least 6 characters long'),
});

export const registerUserSchema = z.object({
	role: z.string(),
	email: z.email('Invalid email'),
	name: z.string().min(2, 'Name must be at least 2 characters long'),
	password: z.string().min(6, 'Password must be at least 6 characters long'),
	Permissions: z.number().nullable(),
	created_at: z.string(),
});

export const registerCustomerSchema = z.object({
	email: z.email('Invalid email'),
	name: z.string().min(2, 'Name must be at least 2 characters long'),
	password: z.string().min(6, 'Password must be at least 6 characters long'),
});

export type Login = z.infer<typeof loginSchema>;
export type UserRegister = z.infer<typeof registerUserSchema>;
export type CustomerRegister = z.infer<typeof registerCustomerSchema>;
