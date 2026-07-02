import type { FastifyInstance } from 'fastify';
import {
	listChatsController,
	listMessagesController,
	markReadController,
	sendMessageController,
	transferAllController,
	transferChatController,
	updateChatController,
} from '../controllers/omni/chat.js';
import {
	createAgentController,
	deleteAgentController,
	deleteKbFileController,
	getBusinessConfigController,
	listAgentsController,
	listKbFilesController,
	putBusinessConfigController,
	searchKbController,
	updateAgentController,
	uploadKbFileController,
} from '../controllers/omni/config.js';
import {
	connectInstanceController,
	createInstanceController,
	deleteInstanceController,
	disconnectInstanceController,
	getInstanceController,
	instanceStatsController,
	instanceStatusController,
	listInstancesController,
	updateInstanceController,
} from '../controllers/omni/instance.js';
import {
	omniWebhookController,
	omniWebhookVerifyController,
} from '../controllers/omni/webhook.js';
import { omniPermission } from '../middleware/auth.js';

/**
 * OmniResposta — atendimento WhatsApp por IA (aba do expert). Rotas gateadas
 * por permissão RBAC (`omniresposta.view`/`.edit` via upvox; admin passa).
 * As respostas NÃO declaram schema de saída de propósito: o serializer Zod
 * strippa campos fora do schema (armadilha conhecida) e as entidades evoluem.
 */
export async function omniRoute(server: FastifyInstance) {
	const view = { preHandler: [omniPermission('view')] };
	const edit = { preHandler: [omniPermission('edit')] };
	const tags = ['OmniResposta'];

	// ── Webhook público (sem auth; segredo na URL) ─────────────────────────────
	server.get(
		'/api/omni/webhook/:instanceId/:secret',
		{
			schema: {
				tags,
				description: 'Verificação de webhook (Meta hub.challenge).',
			},
		},
		omniWebhookVerifyController,
	);
	server.post(
		'/api/omni/webhook/:instanceId/:secret',
		{
			schema: {
				tags,
				description: 'Ingest de eventos do provedor (Z-API/Evolution/Meta).',
			},
		},
		omniWebhookController,
	);

	// ── Instâncias ──────────────────────────────────────────────────────────────
	server.get(
		'/api/omni/instances',
		{
			...view,
			schema: {
				tags,
				description: 'Lista instâncias do expert (admin vê todas).',
				security: [{ bearerAuth: [] }],
			},
		},
		listInstancesController,
	);
	server.post(
		'/api/omni/instances',
		{
			...edit,
			schema: {
				tags,
				description: 'Cria instância (zapi|evolution|meta).',
				security: [{ bearerAuth: [] }],
			},
		},
		createInstanceController,
	);
	server.get(
		'/api/omni/instances/:id',
		{ ...view, schema: { tags, security: [{ bearerAuth: [] }] } },
		getInstanceController,
	);
	server.patch(
		'/api/omni/instances/:id',
		{ ...edit, schema: { tags, security: [{ bearerAuth: [] }] } },
		updateInstanceController,
	);
	server.delete(
		'/api/omni/instances/:id',
		{ ...edit, schema: { tags, security: [{ bearerAuth: [] }] } },
		deleteInstanceController,
	);
	server.post(
		'/api/omni/instances/:id/connect',
		{
			...edit,
			schema: {
				tags,
				description:
					'Cria instância remota se preciso + configura webhook + QR.',
				security: [{ bearerAuth: [] }],
			},
		},
		connectInstanceController,
	);
	server.get(
		'/api/omni/instances/:id/status',
		{ ...view, schema: { tags, security: [{ bearerAuth: [] }] } },
		instanceStatusController,
	);
	server.post(
		'/api/omni/instances/:id/disconnect',
		{ ...edit, schema: { tags, security: [{ bearerAuth: [] }] } },
		disconnectInstanceController,
	);
	server.get(
		'/api/omni/instances/:id/stats',
		{ ...view, schema: { tags, security: [{ bearerAuth: [] }] } },
		instanceStatsController,
	);

	// ── Chats / Mensagens ───────────────────────────────────────────────────────
	server.get(
		'/api/omni/instances/:id/chats',
		{ ...view, schema: { tags, security: [{ bearerAuth: [] }] } },
		listChatsController,
	);
	server.get(
		'/api/omni/chats/:chatId/messages',
		{ ...view, schema: { tags, security: [{ bearerAuth: [] }] } },
		listMessagesController,
	);
	server.post(
		'/api/omni/chats/:chatId/send',
		{
			...edit,
			schema: {
				tags,
				description:
					'Envia como atendente humano: JSON {text} ou multipart (file+caption).',
				security: [{ bearerAuth: [] }],
			},
		},
		sendMessageController,
	);
	server.post(
		'/api/omni/chats/:chatId/mark-read',
		{ ...view, schema: { tags, security: [{ bearerAuth: [] }] } },
		markReadController,
	);
	server.patch(
		'/api/omni/chats/:chatId',
		{
			...edit,
			schema: {
				tags,
				description: 'pin/archive/lead_step/ia_paused/status',
				security: [{ bearerAuth: [] }],
			},
		},
		updateChatController,
	);
	server.post(
		'/api/omni/chats/:chatId/transfer',
		{
			...edit,
			schema: {
				tags,
				description: "{to:'ai'} | {to:'user',userId,userName}",
				security: [{ bearerAuth: [] }],
			},
		},
		transferChatController,
	);
	server.post(
		'/api/omni/instances/:id/chats/transfer-all',
		{ ...edit, schema: { tags, security: [{ bearerAuth: [] }] } },
		transferAllController,
	);

	// ── Agentes ─────────────────────────────────────────────────────────────────
	server.get(
		'/api/omni/instances/:id/agents',
		{ ...view, schema: { tags, security: [{ bearerAuth: [] }] } },
		listAgentsController,
	);
	server.post(
		'/api/omni/instances/:id/agents',
		{ ...edit, schema: { tags, security: [{ bearerAuth: [] }] } },
		createAgentController,
	);
	server.patch(
		'/api/omni/agents/:agentId',
		{ ...edit, schema: { tags, security: [{ bearerAuth: [] }] } },
		updateAgentController,
	);
	server.delete(
		'/api/omni/agents/:agentId',
		{ ...edit, schema: { tags, security: [{ bearerAuth: [] }] } },
		deleteAgentController,
	);

	// ── Config do negócio ───────────────────────────────────────────────────────
	server.get(
		'/api/omni/instances/:id/business-config',
		{ ...view, schema: { tags, security: [{ bearerAuth: [] }] } },
		getBusinessConfigController,
	);
	server.put(
		'/api/omni/instances/:id/business-config',
		{ ...edit, schema: { tags, security: [{ bearerAuth: [] }] } },
		putBusinessConfigController,
	);

	// ── Base de conhecimento (RAG) ──────────────────────────────────────────────
	server.get(
		'/api/omni/instances/:id/kb/files',
		{ ...view, schema: { tags, security: [{ bearerAuth: [] }] } },
		listKbFilesController,
	);
	server.post(
		'/api/omni/instances/:id/kb/files',
		{
			...edit,
			schema: {
				tags,
				description:
					'Upload multipart (PDF/DOCX/TXT/MD ≤20MB) → 202 processing.',
				consumes: ['multipart/form-data'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadKbFileController,
	);
	server.delete(
		'/api/omni/kb/files/:fileId',
		{ ...edit, schema: { tags, security: [{ bearerAuth: [] }] } },
		deleteKbFileController,
	);
	server.post(
		'/api/omni/instances/:id/kb/search',
		{
			...view,
			schema: {
				tags,
				description: 'Teste de busca RAG.',
				security: [{ bearerAuth: [] }],
			},
		},
		searchKbController,
	);
}
