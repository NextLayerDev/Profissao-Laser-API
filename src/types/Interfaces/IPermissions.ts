import { z } from 'zod';

export const PermissionParamsSchema = z.object({
	id: z.string().optional(),
	canEdit: z.boolean(),
	canView: z.boolean(),
	canAdmin: z.boolean(),
	canPrice: z.boolean(),
	description: z.string(),
});

export type PermissionParams = z.infer<typeof PermissionParamsSchema>;
export const PermissionParamsResponse = PermissionParamsSchema;
