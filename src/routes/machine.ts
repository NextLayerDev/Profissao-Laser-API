import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createMachineController,
	createMachineOptionController,
	deleteMachineController,
	deleteMachineOptionController,
	getMachineController,
	listMachinesController,
	updateMachineController,
	updateMachineOptionController,
} from '../controllers/machine.js';
import { authenticateCustomer, requireModule } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	createMachineOptionSchema,
	createMachineSchema,
	machineListResponseSchema,
	machineOptionSchema,
	machineSchema,
	machineWithOptionsSchema,
	updateMachineOptionSchema,
	updateMachineSchema,
} from '../types/machine.js';

export async function machineRoute(server: FastifyInstance) {
	// ── GET /machines — catálogo (customer; staff vê inativos) ──────────────
	server.get(
		'/machines',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Lista o catálogo de máquinas a laser (Fiber/UV/CO2/Diodo) com as opções (potência, lente, software, eixo, operação) agrupadas por categoria.',
				response: {
					200: machineListResponseSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Machines'],
				security: [{ bearerAuth: [] }],
			},
		},
		listMachinesController,
	);

	// ── GET /machines/:id ────────────────────────────────────────────────────
	server.get(
		'/machines/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Detalhe de uma máquina + opções agrupadas por categoria.',
				params: z.object({ id: z.string() }),
				response: {
					200: machineWithOptionsSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Machines'],
				security: [{ bearerAuth: [] }],
			},
		},
		getMachineController,
	);

	// ── POST /machines — admin ───────────────────────────────────────────────
	server.post(
		'/machines',
		{
			preHandler: [requireModule('parametros')],
			schema: {
				description: 'Cria uma máquina no catálogo (apenas staff).',
				body: createMachineSchema,
				response: {
					201: machineSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Machines'],
				security: [{ bearerAuth: [] }],
			},
		},
		createMachineController,
	);

	// ── PATCH /machines/:id — admin ──────────────────────────────────────────
	server.patch(
		'/machines/:id',
		{
			preHandler: [requireModule('parametros')],
			schema: {
				description: 'Atualiza uma máquina (apenas staff).',
				params: z.object({ id: z.string() }),
				body: updateMachineSchema,
				response: {
					200: machineSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Machines'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateMachineController,
	);

	// ── DELETE /machines/:id — admin (cascade opções) ───────────────────────
	server.delete(
		'/machines/:id',
		{
			preHandler: [requireModule('parametros')],
			schema: {
				description: 'Remove uma máquina e todas as suas opções (cascade).',
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
		deleteMachineController,
	);

	// ── POST /machines/:id/options — admin ──────────────────────────────────
	server.post(
		'/machines/:id/options',
		{
			preHandler: [requireModule('parametros')],
			schema: {
				description:
					'Adiciona uma opção à máquina. `category`: power|lens|software|axis|operation.',
				params: z.object({ id: z.string() }),
				body: createMachineOptionSchema,
				response: {
					201: machineOptionSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
				},
				tags: ['Machines'],
				security: [{ bearerAuth: [] }],
			},
		},
		createMachineOptionController,
	);

	// ── PATCH /machines/:id/options/:optionId — admin ───────────────────────
	server.patch(
		'/machines/:id/options/:optionId',
		{
			preHandler: [requireModule('parametros')],
			schema: {
				description: 'Atualiza uma opção da máquina.',
				params: z.object({ id: z.string(), optionId: z.string() }),
				body: updateMachineOptionSchema,
				response: {
					200: machineOptionSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Machines'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateMachineOptionController,
	);

	// ── DELETE /machines/:id/options/:optionId — admin ──────────────────────
	server.delete(
		'/machines/:id/options/:optionId',
		{
			preHandler: [requireModule('parametros')],
			schema: {
				description: 'Remove uma opção da máquina.',
				params: z.object({ id: z.string(), optionId: z.string() }),
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
		deleteMachineOptionController,
	);
}
