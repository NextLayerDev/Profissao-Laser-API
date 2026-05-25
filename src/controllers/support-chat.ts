import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { supportChatService } from '../services/support-chat.js';
import {
	adminListQuerySchema,
	createSupportChatSchema,
	sendSupportMessageSchema,
} from '../types/support-chat.js';

async function isStaff(userId: string): Promise<boolean> {
	const { data } = await supabase
		.from('Users')
		.select('id')
		.eq('id', userId)
		.maybeSingle();
	return !!data;
}

async function userName(userId: string): Promise<string> {
	const { data } = await supabase
		.from('Users')
		.select('name')
		.eq('id', userId)
		.maybeSingle();
	return data?.name ?? 'Atendente';
}

// ── Customer ─────────────────────────────────────────────────────────────

export const createSupportChatController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id ?? '';
		const customerName = request.currentCustomer?.name ?? 'Cliente';
		const { message } = createSupportChatSchema.parse(request.body ?? {});
		const chat = await supportChatService.createChat(
			customerId,
			customerName,
			message,
		);
		return reply.status(201).send(chat);
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

		const userId = request.currentUser?.id ?? '';
		const staff = await isStaff(userId);
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

		const userId = request.currentUser?.id ?? '';
		const staff = await isStaff(userId);
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
		const userId = request.currentUser?.id ?? '';
		if (!(await isStaff(userId))) {
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
		const userId = request.currentUser?.id ?? '';
		if (!(await isStaff(userId))) {
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
		if (!(await isStaff(userId))) {
			return reply.status(403).send({ message: 'Staff access required' });
		}
		const { id } = request.params;
		const { content } = sendSupportMessageSchema.parse(request.body);
		const chat = await supportChatService.adminSendMessage(
			id,
			userId,
			await userName(userId),
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
		if (!(await isStaff(userId))) {
			return reply.status(403).send({ message: 'Staff access required' });
		}
		const { id } = request.params;
		const chat = await supportChatService.takeOver(
			id,
			userId,
			await userName(userId),
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
		const userId = request.currentUser?.id ?? '';
		if (!(await isStaff(userId))) {
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
