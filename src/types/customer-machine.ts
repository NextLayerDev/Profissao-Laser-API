import { z } from 'zod';

// ─── Customer Machine (multi-row, 1 padrão por customer) ──────────────────

export const customerMachineSchema = z.object({
	id: z.uuid(),
	customerId: z.string(),
	name: z.string().nullable(),
	machineId: z.uuid(),
	powerOptionId: z.uuid().nullable(),
	lensOptionId: z.uuid().nullable(),
	softwareOptionId: z.uuid().nullable(),
	axisOptionId: z.uuid().nullable(),
	operationOptionId: z.uuid().nullable(),
	isDefault: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type CustomerMachine = z.infer<typeof customerMachineSchema>;

export const customerMachineListResponseSchema = z.array(customerMachineSchema);

// Create (POST /me/machines). Também usado pelo PUT /me/machine (deprecated)
// via alias `upsertCustomerMachineSchema` mais abaixo.
export const createCustomerMachineSchema = z.object({
	name: z.string().min(1).max(120).optional(),
	machineId: z.uuid(),
	powerOptionId: z.uuid().nullable().optional(),
	lensOptionId: z.uuid().nullable().optional(),
	softwareOptionId: z.uuid().nullable().optional(),
	axisOptionId: z.uuid().nullable().optional(),
	operationOptionId: z.uuid().nullable().optional(),
	isDefault: z.boolean().optional(),
});

export type CreateCustomerMachineInput = z.infer<
	typeof createCustomerMachineSchema
>;

// Update (PATCH /me/machines/:id) — todos opcionais.
export const updateCustomerMachineSchema =
	createCustomerMachineSchema.partial();

export type UpdateCustomerMachineInput = z.infer<
	typeof updateCustomerMachineSchema
>;

// Alias deprecated pra não quebrar imports antigos (PUT /me/machine singular
// continua aceitando o mesmo shape).
export const upsertCustomerMachineSchema = createCustomerMachineSchema;
export type UpsertCustomerMachineInput = CreateCustomerMachineInput;
