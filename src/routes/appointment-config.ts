import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.js';
import {
	addDayOffController,
	addHolidayController,
	deleteDayOffController,
	deleteHolidayController,
	getGlobalConfigController,
	getTechScheduleController,
	listDaysOffController,
	listHolidaysController,
	updateGlobalConfigController,
	upsertTechScheduleController,
} from '../controllers/appointment-config.js';
import {
	createDayOffSchema,
	createHolidaySchema,
	dayOffSchema,
	globalConfigSchema,
	holidaySchema,
	listDaysOffQuerySchema,
	technicianScheduleSchema,
	updateGlobalConfigSchema,
	upsertTechnicianScheduleSchema,
} from '../types/appointment-config.js';
import { ErrorSchema } from '../types/error.js';

export async function appointmentConfigRoute(server: FastifyInstance) {
	// ── Global config ─────────────────────────────────────────────────
	server.get(
		'/appointment-config/global',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Config global de agendamentos (horários, almoço, dias úteis).',
				response: { 200: globalConfigSchema, 500: ErrorSchema },
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		getGlobalConfigController,
	);

	server.put(
		'/appointment-config/global',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Atualiza config global (staff only).',
				body: updateGlobalConfigSchema,
				response: {
					200: globalConfigSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateGlobalConfigController,
	);

	// ── Holidays ──────────────────────────────────────────────────────
	server.get(
		'/appointment-config/holidays',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Lista feriados cadastrados.',
				response: { 200: z.array(holidaySchema), 500: ErrorSchema },
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		listHolidaysController,
	);

	server.post(
		'/appointment-config/holidays',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Adiciona feriado (staff only).',
				body: createHolidaySchema,
				response: { 201: holidaySchema, 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		addHolidayController,
	);

	server.delete(
		'/appointment-config/holidays/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Remove feriado (staff only).',
				params: z.object({ id: z.string() }),
				response: { 204: z.null(), 403: ErrorSchema, 500: ErrorSchema },
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteHolidayController,
	);

	// ── Days off ──────────────────────────────────────────────────────
	server.get(
		'/appointment-config/days-off',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Lista folgas (filtra por technicianId/from/to).',
				querystring: listDaysOffQuerySchema,
				response: { 200: z.array(dayOffSchema), 500: ErrorSchema },
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		listDaysOffController,
	);

	server.post(
		'/appointment-config/days-off',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Cria folga. Staff pode criar pra qualquer técnico (ou global, technicianId=null). Técnico só pode pra si mesmo.',
				body: createDayOffSchema,
				response: { 201: dayOffSchema, 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		addDayOffController,
	);

	server.delete(
		'/appointment-config/days-off/:id',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Remove folga (staff only).',
				params: z.object({ id: z.string() }),
				response: { 204: z.null(), 403: ErrorSchema, 500: ErrorSchema },
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteDayOffController,
	);

	// ── Tech schedule ─────────────────────────────────────────────────
	server.get(
		'/appointment-config/technician/:id',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Override de horário de um técnico (null se sem override).',
				params: z.object({ id: z.string() }),
				response: {
					200: technicianScheduleSchema.nullable(),
					500: ErrorSchema,
				},
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		getTechScheduleController,
	);

	server.put(
		'/appointment-config/technician/:id',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Upsert do override de horário de um técnico. Staff pode editar qualquer um; técnico só si mesmo.',
				params: z.object({ id: z.string() }),
				body: upsertTechnicianScheduleSchema,
				response: {
					200: technicianScheduleSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		upsertTechScheduleController,
	);
}
