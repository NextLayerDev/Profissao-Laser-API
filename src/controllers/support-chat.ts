import type { FastifyReply, FastifyRequest } from 'fastify';
import { isStaffRole } from '../lib/external-auth.js';
import { supportChatService } from '../services/support-chat.js';
import type { AuthContext } from '../services/support-chat-ai.js';
import {
	adminListQuerySchema,
	createSupportChatSchema,
	sendSupportMessageSchema,
} from '../types/support-chat.js';

/**
 * Extrai o contexto de auth do request pra repassar à busca do RAG (que roda na
 * upvox). O Bearer do próprio aluno vale na upvox, então nada de secret novo.
 */
function authFrom(request: FastifyRequest): AuthContext {
	return {
		authHeader: request.headers.authorization ?? null,
		userId: request.currentCustomer?.id ?? null,
	};
}

// ── Customer ─────────────────────────────────────────────────────────────

export const createSupportChatController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		// Sem id não dá pra saber de quem é o atendimento. Degradar para '' faria
		// todos os chamadores não identificados compartilharem o mesmo chat —
		// um lendo a conversa do outro. Melhor recusar.
		const customerId = request.currentCustomer?.id;
		if (!customerId?.trim()) {
			return reply.status(400).send({ message: 'Cliente não identificado' });
		}
		const customerName = request.currentCustomer?.name ?? 'Cliente';
		const { message } = createSupportChatSchema.parse(request.body ?? {});
		const { chat, reused } = await supportChatService.createChat(
			customerId,
			customerName,
			message,
			authFrom(request),
		);
		// 200 quando devolvemos um atendimento que já existia, 201 quando de fato
		// criamos. O front usa `reused` pra avisar "você já tem um atendimento
		// aberto" em vez de abrir uma conversa nova em branco.
		return reply.status(reused ? 200 : 201).send({ ...chat, reused });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const listSupportChatsController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id ?? '';
		const chats = await supportChatService.listForCustomer(customerId);
		return reply.send(chats);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getSupportChatController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const chat = await supportChatService.getById(id);
		if (!chat) return reply.status(404).send({ message: 'Chat not found' });

		const staff = isStaffRole(request.currentRole);
		if (!staff && chat.customerId !== request.currentCustomer?.id) {
			return reply.status(403).send({ message: 'Access denied' });
		}
		return reply.send(chat);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const sendSupportMessageController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const customerId = request.currentCustomer?.id ?? '';
		const customerName = request.currentCustomer?.name ?? 'Cliente';
		const { content } = sendSupportMessageSchema.parse(request.body);
		const chat = await supportChatService.sendCustomerMessage(
			id,
			customerId,
			customerName,
			content,
			authFrom(request),
		);
		return reply.send(chat);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const requestHumanController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const chat = await supportChatService.getById(id);
		if (!chat) return reply.status(404).send({ message: 'Chat not found' });
		if (chat.customerId !== request.currentCustomer?.id) {
			return reply.status(403).send({ message: 'Access denied' });
		}
		const updated = await supportChatService.requestHuman(id, 'manual');
		return reply.send(updated);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const closeSupportChatController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const chat = await supportChatService.getById(id);
		if (!chat) return reply.status(404).send({ message: 'Chat not found' });

		const staff = isStaffRole(request.currentRole);
		if (!staff && chat.customerId !== request.currentCustomer?.id) {
			return reply.status(403).send({ message: 'Access denied' });
		}
		const updated = await supportChatService.closeChat(id);
		return reply.send(updated);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

// ── Admin (staff) ────────────────────────────────────────────────────────

export const listAdminSupportChatsController = async (
	request: FastifyRequest<{ Querystring: { status?: string } }>,
	reply: FastifyReply,
) => {
	try {
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Staff access required' });
		}
		const { status } = adminListQuerySchema.parse(request.query);
		const chats = await supportChatService.listForAdmin(status);
		return reply.send(chats);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const getAdminSupportChatController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Staff access required' });
		}
		const { id } = request.params;
		const chat = await supportChatService.getById(id);
		if (!chat) return reply.status(404).send({ message: 'Chat not found' });
		return reply.send(chat);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const adminSendSupportMessageController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const userId = request.currentUser?.id ?? '';
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Staff access required' });
		}
		const { id } = request.params;
		const { content } = sendSupportMessageSchema.parse(request.body);
		const chat = await supportChatService.adminSendMessage(
			id,
			userId,
			request.currentUser?.name ?? 'Atendente',
			content,
		);
		return reply.send(chat);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const takeOverSupportChatController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const userId = request.currentUser?.id ?? '';
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Staff access required' });
		}
		const { id } = request.params;
		const chat = await supportChatService.takeOver(
			id,
			userId,
			request.currentUser?.name ?? 'Atendente',
		);
		return reply.send(chat);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const adminCloseSupportChatController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		if (!isStaffRole(request.currentRole)) {
			return reply.status(403).send({ message: 'Staff access required' });
		}
		const { id } = request.params;
		const chat = await supportChatService.getById(id);
		if (!chat) return reply.status(404).send({ message: 'Chat not found' });
		const updated = await supportChatService.closeChat(id);
		return reply.send(updated);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};
