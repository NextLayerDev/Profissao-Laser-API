import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createCustomerMachineController,
	deleteCustomerMachineController,
	deleteCustomerMachineSingularController,
	getCustomerMachineController,
	listCustomerMachinesController,
	putCustomerMachineController,
	updateCustomerMachineController,
} from '../controllers/customer-machine.js';
import { authenticateCustomer } from '../middleware/auth.js';
import {
	createCustomerMachineSchema,
	customerMachineListResponseSchema,
	customerMachineSchema,
	updateCustomerMachineSchema,
	upsertCustomerMachineSchema,
} from '../types/customer-machine.js';
import { ErrorSchema } from '../types/error.js';

export async function customerMachineRoute(server: FastifyInstance) {
	// ── Plural — multi-máquina ─────────────────────────────────────────────

	server.get(
		'/me/machines',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Lista as máquinas salvas do customer (default primeiro, depois por `createdAt` desc). Pelo menos uma é marcada como `isDefault: true` (usada quando o parameter-lookup é chamado sem `machineId` na query).',
				response: {
					200: customerMachineListResponseSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Machines'],
				security: [{ bearerAuth: [] }],
			},
		},
		listCustomerMachinesController,
	);

	server.post(
		'/me/machines',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Cadastra uma máquina salva pro customer. `name` opcional (rótulo). Se for a 1ª, vira `isDefault: true` automaticamente; se mandar `isDefault:true` com outras existentes, a anterior é desmarcada.',
				body: createCustomerMachineSchema,
				response: {
					201: customerMachineSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Machines'],
				security: [{ bearerAuth: [] }],
			},
		},
		createCustomerMachineController,
	);

	server.patch(
		'/me/machines/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Atualiza uma máquina salva. Setar `isDefault:true` desmarca a default anterior atomicamente.',
				params: z.object({ id: z.string() }),
				body: updateCustomerMachineSchema,
				response: {
					200: customerMachineSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Machines'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateCustomerMachineController,
	);

	server.delete(
		'/me/machines/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Remove uma máquina salva. Se era a default e ainda há outras, a mais antiga vira default automaticamente.',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Machines'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteCustomerMachineController,
	);

	// ── Singular (DEPRECATED — aponta pra default) ─────────────────────────

	server.get(
		'/me/machine',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'DEPRECATED — use `GET /me/machines`. Retorna a máquina default do customer (404 se não tiver nenhuma cadastrada).',
				response: {
					200: customerMachineSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Machines'],
				security: [{ bearerAuth: [] }],
			},
		},
		getCustomerMachineController,
	);

	server.put(
		'/me/machine',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'DEPRECATED — use `POST /me/machines` ou `PATCH /me/machines/:id`. Upsert na máquina default do customer (cria se não houver; atualiza a default existente).',
				body: upsertCustomerMachineSchema,
				response: {
					200: customerMachineSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Machines'],
				security: [{ bearerAuth: [] }],
			},
		},
		putCustomerMachineController,
	);

	server.delete(
		'/me/machine',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'DEPRECATED — use `DELETE /me/machines/:id`. Remove a máquina default do customer (promove a próxima mais antiga se houver).',
				response: {
					204: z.null(),
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Machines'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteCustomerMachineSingularController,
	);
}
