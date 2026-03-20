import { supabase } from '../lib/supabase.js';
import type {
	CreateChat,
	CreateDefaultQuestion,
	CreateDoubtCategory,
	SendChatMessage,
	UpdateDefaultQuestion,
	UpdateDoubtCategory,
} from '../types/doubt-chat.js';

class DoubtChatRepository {
	// ── Categories ──────────────────────────────────────────────────────────────

	async listCategories() {
		const { data, error } = await supabase
			.from('pl_doubt_category')
			.select('id, title, description, order')
			.order('order', { ascending: true });

		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async createCategory(data: CreateDoubtCategory) {
		const { data: row, error } = await supabase
			.from('pl_doubt_category')
			.insert({
				id: crypto.randomUUID(),
				title: data.title,
				description: data.description ?? null,
				order: data.order ?? 0,
			})
			.select('id, title, description, order')
			.single();

		if (error) throw new Error(error.message);
		return row;
	}

	async updateCategory(id: string, data: UpdateDoubtCategory) {
		const { data: row, error } = await supabase
			.from('pl_doubt_category')
			.update({
				...(data.title !== undefined && { title: data.title }),
				...(data.description !== undefined && {
					description: data.description,
				}),
				...(data.order !== undefined && { order: data.order }),
			})
			.eq('id', id)
			.select('id, title, description, order')
			.single();

		if (error) throw new Error(error.message);
		return row;
	}

	async deleteCategory(id: string) {
		const { error } = await supabase
			.from('pl_doubt_category')
			.delete()
			.eq('id', id);

		if (error) throw new Error(error.message);
	}

	async reorderCategories(ids: string[]) {
		for (let i = 0; i < ids.length; i++) {
			const { error } = await supabase
				.from('pl_doubt_category')
				.update({ order: i })
				.eq('id', ids[i]);

			if (error) throw new Error(error.message);
		}
	}

	// ── Technicians ─────────────────────────────────────────────────────────────

	async listTechnicians() {
		const { data, error } = await supabase
			.from('Users')
			.select('id, name, email');

		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async getTechnicianById(id: string) {
		const { data: user, error } = await supabase
			.from('Users')
			.select('id, name, email')
			.eq('id', id)
			.maybeSingle();

		if (error) throw new Error(error.message);
		if (!user) return null;

		const questions = await this.listDefaultQuestions(id);

		return { ...user, defaultQuestions: questions };
	}

	// ── Default Questions ───────────────────────────────────────────────────────

	async listDefaultQuestions(technicianId: string) {
		const { data, error } = await supabase
			.from('pl_doubt_default_question')
			.select('id, text, type, options, order')
			.eq('technicianId', technicianId)
			.order('order', { ascending: true });

		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async createDefaultQuestion(
		technicianId: string,
		data: CreateDefaultQuestion,
	) {
		const { data: row, error } = await supabase
			.from('pl_doubt_default_question')
			.insert({
				id: crypto.randomUUID(),
				technicianId,
				text: data.text,
				type: data.type,
				options: data.options ?? null,
				order: data.order ?? 0,
			})
			.select('id, text, type, options, order')
			.single();

		if (error) throw new Error(error.message);
		return row;
	}

	async updateDefaultQuestion(id: string, data: UpdateDefaultQuestion) {
		const { data: row, error } = await supabase
			.from('pl_doubt_default_question')
			.update({
				...(data.text !== undefined && { text: data.text }),
				...(data.type !== undefined && { type: data.type }),
				...(data.options !== undefined && { options: data.options }),
				...(data.order !== undefined && { order: data.order }),
			})
			.eq('id', id)
			.select('id, text, type, options, order')
			.single();

		if (error) throw new Error(error.message);
		return row;
	}

	async deleteDefaultQuestion(id: string) {
		const { error } = await supabase
			.from('pl_doubt_default_question')
			.delete()
			.eq('id', id);

		if (error) throw new Error(error.message);
	}

	async reorderDefaultQuestions(ids: string[]) {
		for (let i = 0; i < ids.length; i++) {
			const { error } = await supabase
				.from('pl_doubt_default_question')
				.update({ order: i })
				.eq('id', ids[i]);

			if (error) throw new Error(error.message);
		}
	}

	// ── Chats ───────────────────────────────────────────────────────────────────

	async listChatsByCustomer(customerId: string, status?: string) {
		let query = supabase
			.from('pl_doubt_chat')
			.select(
				'id, categoryId, technicianId, customerId, status, createdAt, updatedAt',
			)
			.eq('customerId', customerId)
			.order('updatedAt', { ascending: false });

		if (status) {
			query = query.eq('status', status);
		}

		const { data: chats, error } = await query;
		if (error) throw new Error(error.message);

		return this._enrichChatSummaries(chats ?? []);
	}

	async listAllChats(categoryId?: string) {
		let query = supabase
			.from('pl_doubt_chat')
			.select(
				'id, categoryId, technicianId, customerId, status, createdAt, updatedAt',
			)
			.order('updatedAt', { ascending: false });

		if (categoryId) {
			query = query.eq('categoryId', categoryId);
		}

		const { data: chats, error } = await query;
		if (error) throw new Error(error.message);

		return this._enrichChatSummaries(chats ?? []);
	}

	private async _enrichChatSummaries(
		chats: Array<{
			id: string;
			categoryId: string;
			technicianId: string | null;
			customerId: string;
			status: string;
			createdAt: string;
			updatedAt: string;
		}>,
	) {
		if (chats.length === 0) return [];

		const categoryIds = [...new Set(chats.map((c) => c.categoryId))];
		const technicianIds = [
			...new Set(chats.map((c) => c.technicianId).filter(Boolean) as string[]),
		];
		const customerIds = [...new Set(chats.map((c) => c.customerId))];

		const [categories, technicians, customers] = await Promise.all([
			categoryIds.length > 0
				? supabase
						.from('pl_doubt_category')
						.select('id, title')
						.in('id', categoryIds)
				: { data: [] },
			technicianIds.length > 0
				? supabase.from('Users').select('id, name').in('id', technicianIds)
				: { data: [] },
			customerIds.length > 0
				? supabase.from('Customers').select('id, name').in('id', customerIds)
				: { data: [] },
		]);

		const categoryMap: Record<string, string> = {};
		for (const c of categories.data ?? []) {
			categoryMap[c.id] = c.title;
		}

		const technicianMap: Record<string, string> = {};
		for (const t of technicians.data ?? []) {
			technicianMap[t.id] = t.name;
		}

		const customerMap: Record<string, string> = {};
		for (const c of customers.data ?? []) {
			customerMap[c.id] = c.name;
		}

		return chats.map((chat) => ({
			id: chat.id,
			categoryId: chat.categoryId,
			categoryName: categoryMap[chat.categoryId] ?? null,
			technicianId: chat.technicianId ?? null,
			technicianName: chat.technicianId
				? (technicianMap[chat.technicianId] ?? null)
				: null,
			customerId: chat.customerId,
			customerName: customerMap[chat.customerId] ?? null,
			status: chat.status,
			createdAt: chat.createdAt,
			updatedAt: chat.updatedAt,
		}));
	}

	async getChatById(id: string) {
		const { data: chat, error } = await supabase
			.from('pl_doubt_chat')
			.select(
				'id, categoryId, technicianId, customerId, status, createdAt, updatedAt',
			)
			.eq('id', id)
			.maybeSingle();

		if (error) throw new Error(error.message);
		if (!chat) return null;

		const { data: messages, error: msgError } = await supabase
			.from('pl_doubt_chat_message')
			.select(
				'id, content, fileUrl, authorId, authorName, isTechnician, createdAt',
			)
			.eq('chatId', id)
			.order('createdAt', { ascending: true });

		if (msgError) throw new Error(msgError.message);

		const enriched = await this._enrichChatSummaries([chat]);

		return {
			...enriched[0],
			messages: (messages ?? []).map((m) => ({
				id: m.id,
				content: m.content,
				fileUrl: m.fileUrl,
				authorId: m.authorId,
				authorName: m.authorName,
				isTechnician: m.isTechnician,
				createdAt: m.createdAt,
			})),
		};
	}

	async createChat(
		data: CreateChat,
		customerId: string,
		customerName: string,
		initialFileUrl?: string,
	) {
		const chatId = crypto.randomUUID();
		const now = new Date().toISOString();

		const { error: chatError } = await supabase.from('pl_doubt_chat').insert({
			id: chatId,
			categoryId: data.categoryId,
			technicianId: data.technicianId ?? null,
			customerId,
			status: 'open',
			qualificationAnswers: data.qualificationAnswers ?? null,
			createdAt: now,
			updatedAt: now,
		});

		if (chatError) throw new Error(chatError.message);

		const { error: msgError } = await supabase
			.from('pl_doubt_chat_message')
			.insert({
				id: crypto.randomUUID(),
				chatId,
				authorId: customerId,
				authorName: customerName,
				isTechnician: false,
				content: data.initialMessage ?? '',
				fileUrl: initialFileUrl ?? null,
				createdAt: now,
			});

		if (msgError) throw new Error(msgError.message);

		return this.getChatById(chatId);
	}

	async assignRandom(chatId: string) {
		const { data: technicians, error } = await supabase
			.from('Users')
			.select('id');

		if (error) throw new Error(error.message);
		if (!technicians || technicians.length === 0) {
			throw new Error('No technicians available');
		}

		const random = technicians[Math.floor(Math.random() * technicians.length)];

		const { error: updateError } = await supabase
			.from('pl_doubt_chat')
			.update({ technicianId: random.id })
			.eq('id', chatId);

		if (updateError) throw new Error(updateError.message);

		return this.getChatById(chatId);
	}

	// ── Messages ────────────────────────────────────────────────────────────────

	async createMessage(
		chatId: string,
		data: SendChatMessage,
		authorId: string,
		authorName: string,
		isTechnician: boolean,
		fileUrl?: string | null,
	) {
		const now = new Date().toISOString();

		const { data: msg, error } = await supabase
			.from('pl_doubt_chat_message')
			.insert({
				id: crypto.randomUUID(),
				chatId,
				authorId,
				authorName,
				isTechnician,
				content: data.content ?? '',
				fileUrl: fileUrl ?? null,
				createdAt: now,
			})
			.select(
				'id, content, fileUrl, authorId, authorName, isTechnician, createdAt',
			)
			.single();

		if (error) throw new Error(error.message);

		const updatePayload: Record<string, string> = { updatedAt: now };
		if (isTechnician) {
			updatePayload.status = 'answered';
		}

		await supabase.from('pl_doubt_chat').update(updatePayload).eq('id', chatId);

		return {
			id: msg.id,
			content: msg.content,
			fileUrl: msg.fileUrl,
			authorId: msg.authorId,
			authorName: msg.authorName,
			isTechnician: msg.isTechnician,
			createdAt: msg.createdAt,
		};
	}
}

export const doubtChatRepository = new DoubtChatRepository();
