import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.js';
import {
	createAppointmentController,
	deleteAppointmentController,
	getAppointmentsByCustomerController,
	getAppointmentsByTechnicianController,
	getAppointmentsController,
	getMyAppointmentsController,
	updateAppointmentStatusController,
} from '../controllers/appointment.js';
import {
	appointmentSchema,
	createAppointmentSchema,
	updateAppointmentStatusSchema,
} from '../types/appointment.js';
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
			preHandler: [authenticate],
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
			preHandler: [authenticate],
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
			preHandler: [authenticate],
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

	server.post(
		'/appointment',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Create a new appointment.',
				body: createAppointmentSchema,
				response: {
					201: appointmentSchema,
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
			preHandler: [authenticate],
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

	server.delete(
		'/appointment/:id',
		{
			preHandler: [authenticate],
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
