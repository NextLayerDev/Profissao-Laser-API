import { z } from 'zod';

/** Uma sessão de mentoria (instância dada de uma tool 'mentoria' publicada). */
export const mentorshipSessionSchema = z.object({
	id: z.string(),
	toolKey: z.string(),
	title: z.string(),
	description: z.string().nullable().optional(),
	date: z.string(),
	time: z.string().nullable().optional(),
	durationMin: z.number().int().nonnegative().default(60),
	joinOpensMinutesBefore: z.number().int().nonnegative().default(10),
	cap: z.number().int().positive().nullable().optional(),
	recordingUrl: z.string().nullable().optional(),
	hostId: z.string().nullable().optional(),
	// O link externo NÃO sai na listagem (revelado só ao entrar, gateado).
});
export type MentorshipSession = z.infer<typeof mentorshipSessionSchema>;

export const createSessionSchema = z.object({
	title: z.string().min(1),
	description: z.string().optional(),
	date: z.string().min(1),
	time: z.string().optional(),
	durationMin: z.number().int().min(0).max(1440).optional(),
	joinOpensMinutesBefore: z.number().int().min(0).max(120).optional(),
	externalUrl: z.string().url(),
	cap: z.number().int().positive().nullable().optional(),
	recordingUrl: z.string().url().nullable().optional(),
	hostId: z.uuid().optional(),
});
export type CreateSession = z.infer<typeof createSessionSchema>;

export const updateSessionSchema = createSessionSchema.partial();
export type UpdateSession = z.infer<typeof updateSessionSchema>;

export const sessionAttendeeSchema = z.object({
	customerId: z.string(),
	customerName: z.string().nullable(),
	customerImage: z.string().nullable(),
	joinedAt: z.string(),
});

/** Estado da sala de uma sessão (timing + presença + acesso do usuário logado). */
export const roomStateSchema = z.object({
	session: mentorshipSessionSchema,
	isOpen: z.boolean(), // sala já abriu (now >= start - opensMinutesBefore)
	isLive: z.boolean(),
	hasEnded: z.boolean(),
	startsAt: z.string(),
	opensAt: z.string(),
	attendees: z.array(sessionAttendeeSchema),
	activeCount: z.number().int(),
	hasJoined: z.boolean(),
	/** Pode entrar? 'included' (plano) | 'pay' (voxes) | 'blocked' (só plano). */
	access: z.enum(['included', 'pay', 'blocked']),
	voxCost: z.number().nonnegative(),
	/** Recursos ligados na tool (gravação/chat/materiais) — vêm da def publicada. */
	features: z.object({
		recording: z.boolean(),
		chat: z.boolean(),
		materials: z.boolean(),
	}),
	/** Link externo (Zoom/Meet): só presente quando o user já entrou. */
	externalUrl: z.string().nullable(),
});
export type RoomState = z.infer<typeof roomStateSchema>;

/* ── Materiais (M4) ── */
export const materialSchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	title: z.string(),
	url: z.string(),
	createdAt: z.string(),
});
export type Material = z.infer<typeof materialSchema>;

export const createMaterialSchema = z.object({
	title: z.string().min(1),
	url: z.string().url(),
});
export type CreateMaterial = z.infer<typeof createMaterialSchema>;

/* ── Chat (M4) ── */
export const messageSchema = z.object({
	id: z.string(),
	customerId: z.string(),
	customerName: z.string().nullable(),
	customerImage: z.string().nullable(),
	content: z.string(),
	createdAt: z.string(),
});
export type Message = z.infer<typeof messageSchema>;

export const postMessageSchema = z.object({
	content: z.string().min(1).max(2000),
});
export type PostMessage = z.infer<typeof postMessageSchema>;

/** Resultado de entrar: revela o link + estado. */
export const joinResultSchema = z.object({
	externalUrl: z.string(),
	state: roomStateSchema,
});
