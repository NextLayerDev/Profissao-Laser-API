import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createSessionController,
	deleteSessionController,
	getRoomController,
	joinRoomController,
	leaveRoomController,
	listSessionsController,
	updateSessionController,
} from '../controllers/mentorship.js';
import { authenticateCommunity } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	createSessionSchema,
	joinResultSchema,
	mentorshipSessionSchema,
	roomStateSchema,
	updateSessionSchema,
} from '../types/mentorship.js';

const TAGS = ['Mentorship'];
const sec = [{ bearerAuth: [] as string[] }];

export async function mentorshipRoute(server: FastifyInstance) {
	// ── Sessões (CRUD) ─────────────────────────────────────────────────────────
	server.get(
		'/mentorship/:toolKey/sessions',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Lista as sessões de uma Mentoria (tool room_v1).',
				params: z.object({ toolKey: z.string() }),
				response: {
					200: z.array(mentorshipSessionSchema),
					401: ErrorSchema,
					500: ErrorSchema,
				},
				tags: TAGS,
				security: sec,
			},
		},
		listSessionsController,
	);

	server.post(
		'/mentorship/:toolKey/sessions',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Cria uma sessão de mentoria (staff).',
				params: z.object({ toolKey: z.string() }),
				body: createSessionSchema,
				response: {
					201: mentorshipSessionSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: TAGS,
				security: sec,
			},
		},
		createSessionController,
	);

	server.patch(
		'/mentorship/sessions/:id',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Atualiza uma sessão (staff) — incl. recordingUrl.',
				params: z.object({ id: z.string() }),
				body: updateSessionSchema,
				response: { 200: mentorshipSessionSchema, 400: ErrorSchema },
				tags: TAGS,
				security: sec,
			},
		},
		updateSessionController,
	);

	server.delete(
		'/mentorship/sessions/:id',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Remove uma sessão (staff).',
				params: z.object({ id: z.string() }),
				response: { 204: z.null(), 400: ErrorSchema, 403: ErrorSchema },
				tags: TAGS,
				security: sec,
			},
		},
		deleteSessionController,
	);

	// ── Sala (entrar/sair) ─────────────────────────────────────────────────────
	server.get(
		'/mentorship/sessions/:id/room',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description:
					'Estado da sala: timing, presentes, acesso (incluído/paga/bloqueado). NÃO revela o link de quem não entrou.',
				params: z.object({ id: z.string() }),
				response: {
					200: roomStateSchema,
					401: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: TAGS,
				security: sec,
			},
		},
		getRoomController,
	);

	server.post(
		'/mentorship/sessions/:id/join',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description:
					'Entra na sala: gateia por plano/voxes, respeita cap e revela o link. Mande invocationId (do invoke do upvox) se a entrada for paga.',
				params: z.object({ id: z.string() }),
				body: z.object({ invocationId: z.string().optional() }).optional(),
				response: {
					200: joinResultSchema,
					401: ErrorSchema,
					402: ErrorSchema, // payment_required
					403: ErrorSchema, // plan_not_allowed / invalid_invocation
					404: ErrorSchema,
					409: ErrorSchema, // room_full
					500: ErrorSchema,
				},
				tags: TAGS,
				security: sec,
			},
		},
		joinRoomController,
	);

	server.post(
		'/mentorship/sessions/:id/leave',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Sai da sala (marca leftAt).',
				params: z.object({ id: z.string() }),
				response: { 204: z.null(), 401: ErrorSchema, 500: ErrorSchema },
				tags: TAGS,
				security: sec,
			},
		},
		leaveRoomController,
	);
}
