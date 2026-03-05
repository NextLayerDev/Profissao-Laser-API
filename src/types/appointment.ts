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
});

export const updateAppointmentStatusSchema = z.object({
	status: z.enum(['pendente', 'confirmado', 'cancelado', 'concluido']),
});

export type AppointmentCreate = z.infer<typeof createAppointmentSchema>;
export type AppointmentStatusUpdate = z.infer<
	typeof updateAppointmentStatusSchema
>;
