import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabase } from '../lib/supabase.js';
import { doubtChatRepository } from '../repositories/doubt-chat.js';
import {
	createChatSchema,
	createDefaultQuestionSchema,
	createDoubtCategorySchema,
	reorderSchema,
	sendChatMessageSchema,
	updateDefaultQuestionSchema,
	updateDoubtCategorySchema,
} from '../types/doubt-chat.js';

async function isStaff(userId: string): Promise<boolean> {
	const { data } = await supabase
		.from('Users')
		.select('id')
		.eq('id', userId)
		.maybeSingle();
	return !!data;
}

// ── Categories ────────────────────────────────────────────────────────────────

export const listCategoriesController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const categories = await doubtChatRepository.listCategories();
		return reply.send(categories);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createCategoryController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const userId = request.currentUser?.id ?? '';
		if (!(await isStaff(userId))) {
			return reply.status(403).send({ message: 'Staff access required' });
		}

		const data = createDoubtCategorySchema.parse(request.body);
		const category = await doubtChatRepository.createCategory(data);
		return reply.status(201).send(category);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateCategoryController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const userId = request.currentUser?.id ?? '';
		if (!(await isStaff(userId))) {
			return reply.status(403).send({ message: 'Staff access required' });
		}

		const { id } = request.params;
		const data = updateDoubtCategorySchema.parse(request.body);
		const category = await doubtChatRepository.updateCategory(id, data);
		return reply.send(category);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteCategoryController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const userId = request.currentUser?.id ?? '';
		if (!(await isStaff(userId))) {
			return reply.status(403).send({ message: 'Staff access required' });
		}

		const { id } = request.params;
		await doubtChatRepository.deleteCategory(id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const reorderCategoriesController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const userId = request.currentUser?.id ?? '';
		if (!(await isStaff(userId))) {
			return reply.status(403).send({ message: 'Staff access required' });
		}

		const { ids } = reorderSchema.parse(request.body);
		await doubtChatRepository.reorderCategories(ids);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

// ── Technicians ───────────────────────────────────────────────────────────────

export const listTechniciansController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const technicians = await doubtChatRepository.listTechnicians();
		return reply.send(technicians);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getTechnicianController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const technician = await doubtChatRepository.getTechnicianById(id);
		if (!technician) {
			return reply.status(404).send({ message: 'Technician not found' });
		}
		return reply.send(technician);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

// ── Default Questions ─────────────────────────────────────────────────────────

export const listDefaultQuestionsController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const questions = await doubtChatRepository.listDefaultQuestions(id);
		return reply.send(questions);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createDefaultQuestionController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const userId = request.currentUser?.id ?? '';
		if (!(await isStaff(userId))) {
			return reply.status(403).send({ message: 'Staff access required' });
		}

		const { id } = request.params;
		const data = createDefaultQuestionSchema.parse(request.body);
		const question = await doubtChatRepository.createDefaultQuestion(id, data);
		return reply.status(201).send(question);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateDefaultQuestionController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const userId = request.currentUser?.id ?? '';
		if (!(await isStaff(userId))) {
			return reply.status(403).send({ message: 'Staff access required' });
		}

		const { id } = request.params;
		const data = updateDefaultQuestionSchema.parse(request.body);
		const question = await doubtChatRepository.updateDefaultQuestion(id, data);
		return reply.send(question);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteDefaultQuestionController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const userId = request.currentUser?.id ?? '';
		if (!(await isStaff(userId))) {
			return reply.status(403).send({ message: 'Staff access required' });
		}

		const { id } = request.params;
		await doubtChatRepository.deleteDefaultQuestion(id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const reorderDefaultQuestionsController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const userId = request.currentUser?.id ?? '';
		if (!(await isStaff(userId))) {
			return reply.status(403).send({ message: 'Staff access required' });
		}

		const { ids } = reorderSchema.parse(request.body);
		await doubtChatRepository.reorderDefaultQuestions(ids);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

// ── Chats ─────────────────────────────────────────────────────────────────────

export const listChatsController = async (
	request: FastifyRequest<{ Querystring: { status?: string } }>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id ?? '';
		const { status } = request.query;
		const chats = await doubtChatRepository.listChatsByCustomer(
			customerId,
			status,
		);
		return reply.send(chats);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const listAdminChatsController = async (
	request: FastifyRequest<{ Querystring: { categoryId?: string } }>,
	reply: FastifyReply,
) => {
	try {
		const userId = request.currentUser?.id ?? '';
		if (!(await isStaff(userId))) {
			return reply.status(403).send({ message: 'Staff access required' });
		}

		const { categoryId } = request.query;
		const chats = await doubtChatRepository.listAllChats(categoryId);
		return reply.send(chats);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createChatController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id ?? '';
		const customerName = request.currentCustomer?.name ?? 'Cliente';
		const data = createChatSchema.parse(request.body);
		const chat = await doubtChatRepository.createChat(
			data,
			customerId,
			customerName,
		);
		return reply.status(201).send(chat);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const getChatController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const chat = await doubtChatRepository.getChatById(id);

		if (!chat) {
			return reply.status(404).send({ message: 'Chat not found' });
		}

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

export const sendMessageController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const data = sendChatMessageSchema.parse(request.body);

		const userId = request.currentUser?.id ?? '';
		const staff = await isStaff(userId);

		let authorId: string;
		let authorName: string;

		if (staff) {
			authorId = userId;
			const { data: user } = await supabase
				.from('Users')
				.select('name')
				.eq('id', userId)
				.maybeSingle();
			authorName = user?.name ?? 'Técnico';
		} else {
			authorId = request.currentCustomer?.id ?? userId;
			authorName = request.currentCustomer?.name ?? 'Cliente';
		}

		const message = await doubtChatRepository.createMessage(
			id,
			data,
			authorId,
			authorName,
			staff,
		);

		return reply.status(201).send(message);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const assignRandomController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const chat = await doubtChatRepository.assignRandom(id);
		return reply.send(chat);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};
