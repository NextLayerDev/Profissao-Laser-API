import { z } from 'zod';
import { PermissionParamsSchema } from './IPermissions';

export const CustomerParamsSchema = z.object({
	email: z.email(),
	name: z.string(),
	stripe: z.string(),
	access: z.string(),
	permission: PermissionParamsSchema,
});

export const UpdateCustomerParamsSchema = CustomerParamsSchema.partial();

export type CustomerParams = z.infer<typeof CustomerParamsSchema>;
export type UpdateCustomerParams = z.infer<typeof UpdateCustomerParamsSchema>;
