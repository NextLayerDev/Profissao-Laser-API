import { z } from 'zod';

export const LoginParamsSchema = z.object({
	email: z.email(),
	password: z.string(),
});

export const RegisterParamsSchema = z.object({
	email: z.email(),
	password: z.string().min(6),
	name: z.string(),
	role: z.string(),
});

export type LoginParams = z.infer<typeof LoginParamsSchema>;
export type RegisterParams = z.infer<typeof RegisterParamsSchema>;
