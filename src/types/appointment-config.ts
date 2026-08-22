import { z } from 'zod';

// ─── Working days bitmap ─────────────────────────────────────────────────
export const workingDaysSchema = z.object({
	mon: z.boolean(),
	tue: z.boolean(),
	wed: z.boolean(),
	thu: z.boolean(),
	fri: z.boolean(),
	sat: z.boolean(),
	sun: z.boolean(),
});
export type WorkingDays = z.infer<typeof workingDaysSchema>;

const timeRegex = /^\d{2}:\d{2}$/;
const timeStr = z.string().regex(timeRegex, 'Formato HH:MM esperado');

// ─── Config global ───────────────────────────────────────────────────────
export const globalConfigSchema = z.object({
	id: z.string(),
	workingDays: workingDaysSchema,
	workingHourStart: timeStr,
	workingHourEnd: timeStr,
	lunchStart: timeStr.nullable(),
	lunchEnd: timeStr.nullable(),
	slotDurationMinutes: z.number().int().positive(),
	// ─── Intervalo mínimo entre atendimentos do mesmo cliente ────────────
	// `.default()` mantém a resposta válida se a migração ainda não rodou —
	// senão o GET /appointment-config/global quebraria com 500 no deploy.
	clientCooldownEnabled: z.boolean().default(false),
	clientCooldownHours: z.number().int().min(1).max(720).default(48),
	clientCooldownMatchPhone: z.boolean().default(true),
	updatedAt: z.string(),
	updatedBy: z.string().nullable(),
});

export const updateGlobalConfigSchema = z.object({
	workingDays: workingDaysSchema.optional(),
	workingHourStart: timeStr.optional(),
	workingHourEnd: timeStr.optional(),
	lunchStart: timeStr.nullable().optional(),
	lunchEnd: timeStr.nullable().optional(),
	slotDurationMinutes: z.number().int().positive().optional(),
	clientCooldownEnabled: z.boolean().optional(),
	clientCooldownHours: z.number().int().min(1).max(720).optional(),
	clientCooldownMatchPhone: z.boolean().optional(),
});

// ─── Holidays ────────────────────────────────────────────────────────────
export const holidaySchema = z.object({
	id: z.string(),
	date: z.string(), // YYYY-MM-DD
	label: z.string(),
	recurringYearly: z.boolean(),
	createdBy: z.string().nullable(),
	createdAt: z.string(),
});

export const createHolidaySchema = z.object({
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD esperado'),
	label: z.string().min(1),
	recurringYearly: z.boolean().optional(),
});

// ─── Days off ────────────────────────────────────────────────────────────
export const dayOffSchema = z.object({
	id: z.string(),
	technicianId: z.string().nullable(),
	date: z.string(),
	reason: z.string().nullable(),
	createdBy: z.string().nullable(),
	createdAt: z.string(),
});

export const createDayOffSchema = z.object({
	technicianId: z.string().uuid().nullable().optional(),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	reason: z.string().optional(),
});

export const listDaysOffQuerySchema = z.object({
	technicianId: z.string().uuid().optional(),
	from: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	to: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
});

// ─── Technician schedule override ────────────────────────────────────────
export const technicianScheduleSchema = z.object({
	id: z.string(),
	technicianId: z.string(),
	workingDays: workingDaysSchema.nullable(),
	workingHourStart: timeStr.nullable(),
	workingHourEnd: timeStr.nullable(),
	lunchStart: timeStr.nullable(),
	lunchEnd: timeStr.nullable(),
	updatedAt: z.string(),
});

export const upsertTechnicianScheduleSchema = z.object({
	workingDays: workingDaysSchema.nullable().optional(),
	workingHourStart: timeStr.nullable().optional(),
	workingHourEnd: timeStr.nullable().optional(),
	lunchStart: timeStr.nullable().optional(),
	lunchEnd: timeStr.nullable().optional(),
});

// ─── Bloqueios recorrentes (toda semana) ─────────────────────────────────
// Fecha um dia da semana TODA semana: o dia inteiro (startTime/endTime nulos)
// ou só uma faixa de horário (ex.: toda sexta 16:00–17:00). Global
// (technicianId null) ou por técnico.
export const weekdaySchema = z.enum([
	'mon',
	'tue',
	'wed',
	'thu',
	'fri',
	'sat',
	'sun',
]);
export type Weekday = z.infer<typeof weekdaySchema>;

export const recurringBlockSchema = z.object({
	id: z.string(),
	technicianId: z.string().nullable(),
	weekday: weekdaySchema,
	startTime: timeStr.nullable(),
	endTime: timeStr.nullable(),
	reason: z.string().nullable(),
	createdBy: z.string().nullable(),
	createdAt: z.string(),
});

export const createRecurringBlockSchema = z
	.object({
		technicianId: z.string().uuid().nullable().optional(),
		weekday: weekdaySchema,
		startTime: timeStr.nullable().optional(),
		endTime: timeStr.nullable().optional(),
		reason: z.string().optional(),
	})
	.refine((d) => (d.startTime == null) === (d.endTime == null), {
		message: 'Preencha início e fim juntos, ou deixe ambos vazios (dia todo)',
	})
	.refine(
		(d) => d.startTime == null || d.endTime == null || d.startTime < d.endTime,
		{ message: 'Início deve ser antes do fim' },
	);

export const listRecurringBlocksQuerySchema = z.object({
	technicianId: z.string().uuid().optional(),
	weekday: weekdaySchema.optional(),
});

// ─── Slot picker response ────────────────────────────────────────────────
// Quando o dia está totalmente bloqueado (feriado / folga / sem expediente),
// retorna {slots: [], blocked: true, reason: '...'}.
export const availableSlotsResponseSchema = z.object({
	slots: z.array(z.string()),
	blocked: z.boolean(),
	reason: z.string().nullable(),
});

// ─── Intervalo mínimo entre atendimentos ─────────────────────────────────
// Só pra UI (banner + trava do input de data). A regra de verdade é aplicada
// no POST /appointment.
export const clientCooldownQuerySchema = z.object({
	/** Staff consulta qualquer cliente; customer recebe sempre a própria situação. */
	email: z.string().optional(),
	phone: z.string().optional(),
	from: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	days: z.coerce.number().int().min(1).max(120).optional(),
});

export const clientCooldownResponseSchema = z.object({
	enabled: z.boolean(),
	hours: z.number().int(),
	matchPhone: z.boolean(),
	/** O dia inicial da consulta (hoje, ou `from`) está bloqueado? */
	blocked: z.boolean(),
	/** Primeira data com algum horário livre, ou null se nada bloqueia. */
	nextAllowedDate: z.string().nullable(),
	/** Dias 100% bloqueados dentro da janela consultada. */
	blockedDates: z.array(z.string()),
	/** O atendimento futuro mais distante — é ele que o banner cita. */
	lastAppointment: z
		.object({
			id: z.string(),
			date: z.string(),
			time: z.string(),
			service: z.string().nullable(),
		})
		.nullable(),
});

export type GlobalConfig = z.infer<typeof globalConfigSchema>;
export type UpdateGlobalConfig = z.infer<typeof updateGlobalConfigSchema>;
export type Holiday = z.infer<typeof holidaySchema>;
export type CreateHoliday = z.infer<typeof createHolidaySchema>;
export type DayOff = z.infer<typeof dayOffSchema>;
export type CreateDayOff = z.infer<typeof createDayOffSchema>;
export type TechnicianSchedule = z.infer<typeof technicianScheduleSchema>;
export type UpsertTechnicianSchedule = z.infer<
	typeof upsertTechnicianScheduleSchema
>;
export type RecurringBlock = z.infer<typeof recurringBlockSchema>;
export type CreateRecurringBlock = z.infer<typeof createRecurringBlockSchema>;
export type AvailableSlotsResponse = z.infer<
	typeof availableSlotsResponseSchema
>;
export type ClientCooldownQuery = z.infer<typeof clientCooldownQuerySchema>;
export type ClientCooldownResponse = z.infer<
	typeof clientCooldownResponseSchema
>;
