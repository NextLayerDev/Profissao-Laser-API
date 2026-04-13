import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { uploadDoubtFile } from '../lib/storage.js';
import { supabase } from '../lib/supabase.js';
import { doubtChatRepository } from '../repositories/doubt-chat.js';
import {
	createChatSchema,
	createDefaultQuestionSchema,
	createDoubtCategorySchema,
	reorderSchema,
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

		const parts = request.parts();
		let categoryId = '';
		let technicianId: string | undefined;
		let qualificationAnswers: Record<string, string> | undefined;
		let initialMessage: string | undefined;
		let initialFileUrl: string | undefined;

		for await (const part of parts) {
			if (part.type === 'field') {
				if (part.fieldname === 'categoryId') {
					categoryId = part.value as string;
				} else if (part.fieldname === 'technicianId') {
					technicianId = part.value as string;
				} else if (part.fieldname === 'qualificationAnswers') {
					try {
						qualificationAnswers = JSON.parse(part.value as string);
					} catch {
						// ignore invalid JSON
					}
				} else if (part.fieldname === 'initialMessage') {
					initialMessage = part.value as string;
				}
			} else if (part.type === 'file' && part.fieldname === 'file') {
				const buffer = await part.toBuffer();
				const ext = part.filename?.split('.').pop() ?? 'bin';
				const path = `init/${crypto.randomUUID()}.${ext}`;
				initialFileUrl = await uploadDoubtFile(buffer, path, part.mimetype);
			}
		}

		if (!categoryId) {
			return reply.status(400).send({ message: 'categoryId is required' });
		}

		if (!initialMessage && !initialFileUrl) {
			return reply
				.status(400)
				.send({ message: 'initialMessage or file is required' });
		}

		const data = createChatSchema.parse({
			categoryId,
			technicianId,
			qualificationAnswers,
			initialMessage,
		});

		const chat = await doubtChatRepository.createChat(
			data,
			customerId,
			customerName,
			initialFileUrl,
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

		const parts = request.parts();
		let content = '';
		let fileUrl: string | undefined;

		for await (const part of parts) {
			if (part.type === 'field' && part.fieldname === 'content') {
				content = part.value as string;
			} else if (part.type === 'file' && part.fieldname === 'file') {
				const buffer = await part.toBuffer();
				const ext = part.filename?.split('.').pop() ?? 'bin';
				const path = `${id}/${crypto.randomUUID()}.${ext}`;
				fileUrl = await uploadDoubtFile(buffer, path, part.mimetype);
			}
		}

		if (!content && !fileUrl) {
			return reply.status(400).send({ message: 'Content or file is required' });
		}

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
			{ content: content || undefined },
			authorId,
			authorName,
			staff,
			fileUrl,
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
