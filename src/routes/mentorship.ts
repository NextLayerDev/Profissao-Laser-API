import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	addMaterialController,
	createSessionController,
	deleteMaterialController,
	deleteSessionController,
	getRoomController,
	joinRoomController,
	leaveRoomController,
	listMaterialsController,
	listMessagesController,
	listSessionsController,
	postMessageController,
	updateSessionController,
} from '../controllers/mentorship.js';
import { authenticateCommunity } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	createMaterialSchema,
	createSessionSchema,
	joinResultSchema,
	materialSchema,
	mentorshipSessionSchema,
	messageSchema,
	postMessageSchema,
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

	// ── Materiais ───────────────────────────────────────────────────────────────
	server.get(
		'/mentorship/sessions/:id/materials',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description:
					'Materiais da sessão. Visível a quem é incluído (plano/staff) ou já entrou.',
				params: z.object({ id: z.string() }),
				response: {
					200: z.array(materialSchema),
					401: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
				},
				tags: TAGS,
				security: sec,
			},
		},
		listMaterialsController,
	);

	server.post(
		'/mentorship/sessions/:id/materials',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Adiciona um material (staff) — título + URL.',
				params: z.object({ id: z.string() }),
				body: createMaterialSchema,
				response: { 201: materialSchema, 400: ErrorSchema, 403: ErrorSchema },
				tags: TAGS,
				security: sec,
			},
		},
		addMaterialController,
	);

	server.delete(
		'/mentorship/materials/:materialId',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Remove um material (staff).',
				params: z.object({ materialId: z.string() }),
				response: { 204: z.null(), 403: ErrorSchema, 500: ErrorSchema },
				tags: TAGS,
				security: sec,
			},
		},
		deleteMaterialController,
	);

	// ── Chat ──────────────────────────────────────────────────────────────────
	server.get(
		'/mentorship/sessions/:id/messages',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Mensagens do chat da sessão (só quem está na sala).',
				params: z.object({ id: z.string() }),
				response: {
					200: z.array(messageSchema),
					401: ErrorSchema,
					403: ErrorSchema, // not_in_room
				},
				tags: TAGS,
				security: sec,
			},
		},
		listMessagesController,
	);

	server.post(
		'/mentorship/sessions/:id/messages',
		{
			preHandler: [authenticateCommunity],
			schema: {
				description: 'Envia uma mensagem no chat (só quem está na sala).',
				params: z.object({ id: z.string() }),
				body: postMessageSchema,
				response: {
					201: messageSchema,
					400: ErrorSchema,
					401: ErrorSchema,
					403: ErrorSchema,
				},
				tags: TAGS,
				security: sec,
			},
		},
		postMessageController,
	);
}
