import { z } from 'zod';

export const customerSchema = z.object({
	id: z.string(),
	email: z.email(),
	stripe: z.string(),
	access: z.string(),
	name: z.string().min(2),
	password: z.string().min(6),
	role: z.string().optional(),
	phone: z.string().nullish(),
	isTestUnlimited: z.boolean().optional(),
});

export type Customer = z.infer<typeof customerSchema>;
export type CustomerUpdate = Partial<Customer>;

// ─── Perfil do customer (self) ───────────────────────────────────────────────

export const customerProfileSchema = z.object({
	id: z.string(),
	name: z.string().nullable(),
	email: z.string().nullable(),
	nickname: z.string().nullable(),
	bio: z.string().nullable(),
	avatar: z.string().nullable(),
});
export type CustomerProfile = z.infer<typeof customerProfileSchema>;

export const updateProfileSchema = z.object({
	name: z.string().min(2).optional(),
	nickname: z.string().max(40).nullish(),
	bio: z.string().max(500).nullish(),
	// URL do avatar: ícone-preset (/avatars/*.png) ou foto enviada (Bunny).
	image: z.string().max(500).nullish(),
});
export type UpdateProfile = z.infer<typeof updateProfileSchema>;

export const changeMyPasswordSchema = z.object({
	currentPassword: z.string().min(1),
	newPassword: z.string().min(6),
});
