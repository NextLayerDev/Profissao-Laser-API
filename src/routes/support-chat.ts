import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateCustomer, requireModule } from '@/middleware/auth.js';
import {
	adminCloseSupportChatController,
	adminSendSupportMessageController,
	closeSupportChatController,
	createSupportChatController,
	getAdminSupportChatController,
	getSupportChatController,
	listAdminSupportChatsController,
	listSupportChatsController,
	requestHumanController,
	sendSupportMessageController,
	takeOverSupportChatController,
} from '../controllers/support-chat.js';
import { ErrorSchema } from '../types/error.js';
import {
	adminListQuerySchema,
	createSupportChatSchema,
	sendSupportMessageSchema,
	supportChatSchema,
	supportChatSummarySchema,
} from '../types/support-chat.js';

const idParam = z.object({ id: z.string() });

export async function supportChatRoute(server: FastifyInstance) {
	// ── Admin (staff) — declarado antes das rotas :id pra evitar colisão ──
	server.get(
		'/support-chats/admin',
		{
			preHandler: [requireModule('suporte')],
			schema: {
				description:
					'List all support chats, optionally by status (staff only).',
				querystring: adminListQuerySchema,
				response: {
					200: z.array(supportChatSummarySchema),
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Support Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		listAdminSupportChatsController,
	);

	server.get(
		'/support-chats/admin/:id',
		{
			preHandler: [requireModule('suporte')],
			schema: {
				description: 'Get a support chat with messages (staff only, polling).',
				params: idParam,
				response: {
					200: supportChatSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Support Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		getAdminSupportChatController,
	);

	server.post(
		'/support-chats/admin/:id/messages',
		{
			preHandler: [requireModule('suporte')],
			schema: {
				description: 'Attendant replies in a support chat (staff only).',
				params: idParam,
				body: sendSupportMessageSchema,
				response: {
					200: supportChatSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Support Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		adminSendSupportMessageController,
	);

	server.post(
		'/support-chats/admin/:id/take-over',
		{
			preHandler: [requireModule('suporte')],
			schema: {
				description: 'Attendant takes over the conversation (staff only).',
				params: idParam,
				response: {
					200: supportChatSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Support Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		takeOverSupportChatController,
	);

	server.post(
		'/support-chats/admin/:id/close',
		{
			preHandler: [requireModule('suporte')],
			schema: {
				description: 'Close a support chat (staff only).',
				params: idParam,
				response: {
					200: supportChatSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Support Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		adminCloseSupportChatController,
	);

	// ── Customer ──
	server.post(
		'/support-chats',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Open a new live support chat (AI-first). Optional opening message.',
				body: createSupportChatSchema,
				response: { 201: supportChatSchema, 400: ErrorSchema },
				tags: ['Support Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		createSupportChatController,
	);

	server.get(
		'/support-chats',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: "List the current customer's support chats.",
				response: {
					200: z.array(supportChatSummarySchema),
					500: ErrorSchema,
				},
				tags: ['Support Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		listSupportChatsController,
	);

	server.get(
		'/support-chats/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Get a support chat with messages (polling).',
				params: idParam,
				response: {
					200: supportChatSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Support Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		getSupportChatController,
	);

	server.post(
		'/support-chats/:id/messages',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Customer sends a message; while AI is handling, the AI reply comes back synchronously.',
				params: idParam,
				body: sendSupportMessageSchema,
				response: {
					200: supportChatSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Support Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		sendSupportMessageController,
	);

	server.post(
		'/support-chats/:id/request-human',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Customer requests a human attendant (handoff).',
				params: idParam,
				response: {
					200: supportChatSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Support Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		requestHumanController,
	);

	server.post(
		'/support-chats/:id/close',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Close the support chat.',
				params: idParam,
				response: {
					200: supportChatSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Support Chat'],
				security: [{ bearerAuth: [] }],
			},
		},
		closeSupportChatController,
	);
}
