import { z } from 'zod';

export const roleSchema = z.object({
	id: z.number(),
	role: z.string(),
	label: z.string().nullable().optional(),
	grants: z.array(z.string()).default([]),
	isSuperAdmin: z.boolean().default(false),
	// Flags legadas (mantidas por compat; não usadas pelo novo modelo).
	canEdit: z.boolean().nullable().optional(),
	canView: z.boolean().nullable().optional(),
	canAdmin: z.boolean().nullable().optional(),
	canPrice: z.boolean().nullable().optional(),
});

export const roleCreateSchema = z.object({
	role: z.string().min(1),
	label: z.string().optional(),
	grants: z.array(z.string()).default([]),
	isSuperAdmin: z.boolean().default(false),
});

export const roleUpdateSchema = roleCreateSchema.partial();

export const permissionModuleSchema = z.object({
	module: z.string(),
	label: z.string(),
	actions: z.array(z.string()),
});

export const effectivePermissionsSchema = z.object({
	isSuperAdmin: z.boolean(),
	permissions: z.array(z.string()),
});

export type Role = z.infer<typeof roleSchema>;
export type RoleCreate = z.infer<typeof roleCreateSchema>;
export type RoleUpdate = z.infer<typeof roleUpdateSchema>;
