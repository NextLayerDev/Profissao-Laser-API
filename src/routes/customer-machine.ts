import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	deleteCustomerMachineController,
	getCustomerMachineController,
	putCustomerMachineController,
} from '../controllers/customer-machine.js';
import { authenticateCustomer } from '../middleware/auth.js';
import {
	customerMachineSchema,
	upsertCustomerMachineSchema,
} from '../types/customer-machine.js';
import { ErrorSchema } from '../types/error.js';

export async function customerMachineRoute(server: FastifyInstance) {
	server.get(
		'/me/machine',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Retorna a máquina salva do customer logado (tipo + opções selecionadas). 404 se não tiver cadastrada.',
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
					'Salva/atualiza a máquina do customer (singleton). `machineId` obrigatório; optionIds opcionais (potência, lente, software, eixo, operação).',
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
				description: 'Remove a máquina salva do customer.',
				response: {
					204: z.null(),
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Machines'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteCustomerMachineController,
	);
}
