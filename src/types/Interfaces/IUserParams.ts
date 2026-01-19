import { z } from 'zod';
import { PermissionParamsSchema } from './IPermissions';

export const UserParamsSchema = z.object({
	email: z.email(),
	name: z.string(),
	role: z.string(),
	permission: PermissionParamsSchema,
});

export const UpdateUserParamsSchema = UserParamsSchema.partial();

export type UserParams = z.infer<typeof UserParamsSchema>;
export type UpdateUserParams = z.infer<typeof UpdateUserParamsSchema>;
