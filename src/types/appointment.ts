import { z } from 'zod';

export const appointmentSchema = z.object({
	id: z.uuid(),
	customerName: z.string(),
	customerEmail: z.string(),
	customerPhone: z.string().nullable(),
	service: z.string(),
	date: z.string(),
	time: z.string(),
	status: z.enum(['pendente', 'confirmado', 'cancelado', 'concluido']),
	notes: z.string().nullable(),
	technicianId: z.string().uuid().nullable(),
	createdAt: z.string(),
});

export const createAppointmentSchema = z.object({
	customerName: z.string(),
	customerEmail: z.string().email(),
	customerPhone: z.string().optional(),
	service: z.string(),
	date: z.string(),
	time: z.string(),
	notes: z.string().optional(),
	technicianId: z.string().uuid().optional(),
});

export const updateAppointmentStatusSchema = z.object({
	status: z.enum(['pendente', 'confirmado', 'cancelado', 'concluido']),
});

export const updateAppointmentTechnicianSchema = z.object({
	technicianId: z.string().uuid(),
});

export type AppointmentCreate = z.infer<typeof createAppointmentSchema>;
export type AppointmentStatusUpdate = z.infer<
	typeof updateAppointmentStatusSchema
>;
export type AppointmentTechnicianUpdate = z.infer<
	typeof updateAppointmentTechnicianSchema
>;
