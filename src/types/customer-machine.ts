import { z } from 'zod';

// ─── Customer Machine (máquina salva — singleton por customer) ────────────

export const customerMachineSchema = z.object({
	customerId: z.string(),
	machineId: z.uuid(),
	powerOptionId: z.uuid().nullable(),
	lensOptionId: z.uuid().nullable(),
	softwareOptionId: z.uuid().nullable(),
	axisOptionId: z.uuid().nullable(),
	operationOptionId: z.uuid().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type CustomerMachine = z.infer<typeof customerMachineSchema>;

export const upsertCustomerMachineSchema = z.object({
	machineId: z.uuid(),
	powerOptionId: z.uuid().nullable().optional(),
	lensOptionId: z.uuid().nullable().optional(),
	softwareOptionId: z.uuid().nullable().optional(),
	axisOptionId: z.uuid().nullable().optional(),
	operationOptionId: z.uuid().nullable().optional(),
});

export type UpsertCustomerMachineInput = z.infer<
	typeof upsertCustomerMachineSchema
>;
