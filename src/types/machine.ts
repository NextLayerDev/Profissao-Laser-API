import { z } from 'zod';

export const machineStatusSchema = z.enum(['ativo', 'inativo']);

export const machineOptionCategorySchema = z.enum([
	'power',
	'lens',
	'software',
	'axis',
	'operation',
]);

export type MachineOptionCategory = z.infer<typeof machineOptionCategorySchema>;

// ─── Machine Option ───────────────────────────────────────────────────────

export const machineOptionSchema = z.object({
	id: z.uuid(),
	machineId: z.uuid(),
	category: machineOptionCategorySchema,
	value: z.string(),
	order: z.number().int(),
	status: machineStatusSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type MachineOption = z.infer<typeof machineOptionSchema>;

export const createMachineOptionSchema = z.object({
	category: machineOptionCategorySchema,
	value: z.string().min(1).max(120),
	order: z.number().int().min(0).default(0),
	status: machineStatusSchema.default('ativo'),
});

export type CreateMachineOptionInput = z.infer<
	typeof createMachineOptionSchema
>;

export const updateMachineOptionSchema = z.object({
	category: machineOptionCategorySchema.optional(),
	value: z.string().min(1).max(120).optional(),
	order: z.number().int().min(0).optional(),
	status: machineStatusSchema.optional(),
});

export type UpdateMachineOptionInput = z.infer<
	typeof updateMachineOptionSchema
>;

// ─── Machine ──────────────────────────────────────────────────────────────

export const machineSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	order: z.number().int(),
	status: machineStatusSchema,
	createdBy: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type Machine = z.infer<typeof machineSchema>;

// Machine + opções agrupadas por category (usado no GET /machines/:id)
export const machineWithOptionsSchema = machineSchema.extend({
	options: z.object({
		power: z.array(machineOptionSchema),
		lens: z.array(machineOptionSchema),
		software: z.array(machineOptionSchema),
		axis: z.array(machineOptionSchema),
		operation: z.array(machineOptionSchema),
	}),
});

export type MachineWithOptions = z.infer<typeof machineWithOptionsSchema>;

export const machineListResponseSchema = z.array(machineWithOptionsSchema);

export const createMachineSchema = z.object({
	name: z.string().min(1).max(120),
	description: z.string().max(2000).optional(),
	order: z.number().int().min(0).default(0),
	status: machineStatusSchema.default('ativo'),
});

export type CreateMachineInput = z.infer<typeof createMachineSchema>;

export const updateMachineSchema = z.object({
	name: z.string().min(1).max(120).optional(),
	description: z.string().max(2000).nullable().optional(),
	order: z.number().int().min(0).optional(),
	status: machineStatusSchema.optional(),
});

export type UpdateMachineInput = z.infer<typeof updateMachineSchema>;
