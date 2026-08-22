import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireModule } from '@/middleware/auth.js';
import {
	cancelMyAppointmentController,
	createAppointmentController,
	deleteAppointmentController,
	getAppointmentsByCustomerController,
	getAppointmentsByTechnicianController,
	getAppointmentsController,
	getAvailableSlotsController,
	getClientCooldownController,
	getMyAppointmentsController,
	updateAppointmentStatusController,
	updateAppointmentTechnicianController,
} from '../controllers/appointment.js';
import {
	appointmentSchema,
	createAppointmentSchema,
	updateAppointmentStatusSchema,
	updateAppointmentTechnicianSchema,
} from '../types/appointment.js';
import {
	availableSlotsResponseSchema,
	clientCooldownQuerySchema,
	clientCooldownResponseSchema,
} from '../types/appointment-config.js';
import { ErrorSchema } from '../types/error.js';

export async function appointmentRoute(server: FastifyInstance) {
	server.get(
		'/appointments',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'List appointments. Admins get all; customers get only their own.',
				response: {
					200: z.array(appointmentSchema),
					500: ErrorSchema,
				},
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		getAppointmentsController,
	);

	server.get(
		'/appointments/:id_customer',
		{
			preHandler: [requireModule('agendamentos')],
			schema: {
				description: 'List appointments for a specific customer (admin only).',
				params: z.object({ id_customer: z.string().uuid() }),
				response: {
					200: z.array(appointmentSchema),
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		getAppointmentsByCustomerController,
	);

	server.get(
		'/technician/appointments',
		{
			preHandler: [requireModule('agendamentos')],
			schema: {
				description:
					'List appointments for the authenticated technician (staff only).',
				response: {
					200: z.array(appointmentSchema),
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		getMyAppointmentsController,
	);

	server.get(
		'/appointments/technician/:id',
		{
			preHandler: [requireModule('agendamentos')],
			schema: {
				description:
					'List appointments for a specific technician (admin only).',
				params: z.object({ id: z.uuid() }),
				response: {
					200: z.array(appointmentSchema),
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		getAppointmentsByTechnicianController,
	);

	server.get(
		'/appointments/available-slots',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Slots disponíveis para a data (respeita feriados, folgas, working days, horário de almoço, config global e overrides por técnico). Retorna {slots, blocked, reason}.',
				querystring: z.object({
					date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
					technicianId: z.string().uuid().optional(),
				}),
				response: {
					200: availableSlotsResponseSchema,
					500: ErrorSchema,
				},
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		getAvailableSlotsController,
	);

	server.get(
		'/appointments/cooldown',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Situação do intervalo mínimo entre atendimentos do cliente. Staff pode consultar por email/phone; customer recebe sempre a própria situação. Retorna {enabled, hours, blocked, nextAllowedDate, blockedDates, lastAppointment}.',
				querystring: clientCooldownQuerySchema,
				response: {
					200: clientCooldownResponseSchema,
					500: ErrorSchema,
				},
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		getClientCooldownController,
	);

	server.post(
		'/appointment',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Create a new appointment.',
				body: createAppointmentSchema,
				response: {
					201: appointmentSchema,
					409: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		createAppointmentController,
	);

	server.patch(
		'/appointment/:id/status',
		{
			preHandler: [requireModule('agendamentos')],
			schema: {
				description: 'Update appointment status (admin only).',
				params: z.object({ id: z.string().uuid() }),
				body: updateAppointmentStatusSchema,
				response: {
					200: appointmentSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateAppointmentStatusController,
	);

	server.patch(
		'/appointment/:id/cancel',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Cancel your own appointment (authenticated customer; matched by e-mail).',
				params: z.object({ id: z.string().uuid() }),
				response: {
					200: appointmentSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		cancelMyAppointmentController,
	);

	server.patch(
		'/appointment/:id',
		{
			preHandler: [requireModule('agendamentos')],
			schema: {
				description: 'Transfer appointment to another technician (admin only).',
				params: z.object({ id: z.uuid() }),
				body: updateAppointmentTechnicianSchema,
				response: {
					200: appointmentSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateAppointmentTechnicianController,
	);

	server.delete(
		'/appointment/:id',
		{
			preHandler: [requireModule('agendamentos')],
			schema: {
				description: 'Delete an appointment (admin only).',
				params: z.object({ id: z.string().uuid() }),
				response: {
					204: z.null(),
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Appointments'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteAppointmentController,
	);
}
