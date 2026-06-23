import crypto from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import type {
	SupportChatStatus,
	SupportMessageRole,
} from '../types/support-chat.js';

interface AddMessageInput {
	role: SupportMessageRole;
	authorId: string | null;
	authorName: string;
	content: string;
}

interface UpdateStatusExtra {
	handoffReason?: string | null;
	attendantId?: string | null;
	closedAt?: string | null;
}

const CHAT_COLS =
	'id, customerId, customerName, attendantId, status, subject, handoffReason, createdAt, updatedAt, closedAt, lastMessageAt, lastMessageRole, lastMessagePreview';
const MSG_COLS =
	'id, chatId, role, authorId, authorName, content, fileUrl, createdAt';

class SupportChatRepository {
	async createChat(customerId: string, customerName: string) {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		const { error } = await supabase.from('pl_support_chat').insert({
			id,
			customerId,
			customerName,
			status: 'ai',
			createdAt: now,
			updatedAt: now,
		});
		if (error) throw new Error(error.message);
		return id;
	}

	async getRawHistory(chatId: string) {
		const { data, error } = await supabase
			.from('pl_support_chat_message')
			.select('role, content')
			.eq('chatId', chatId)
			.order('createdAt', { ascending: true });
		if (error) throw new Error(error.message);
		return (data ?? []) as Array<{ role: SupportMessageRole; content: string }>;
	}

	async addMessage(chatId: string, input: AddMessageInput) {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		const { data, error } = await supabase
			.from('pl_support_chat_message')
			.insert({
				id,
				chatId,
				role: input.role,
				authorId: input.authorId,
				authorName: input.authorName,
				content: input.content,
				createdAt: now,
			})
			.select(MSG_COLS)
			.single();
		if (error) throw new Error(error.message);

		await supabase
			.from('pl_support_chat')
			.update({
				updatedAt: now,
				lastMessageAt: now,
				lastMessageRole: input.role,
				lastMessagePreview: input.content.slice(0, 120),
			})
			.eq('id', chatId);

		return data;
	}

	async updateStatus(
		chatId: string,
		status: SupportChatStatus,
		extra: UpdateStatusExtra = {},
	) {
		const payload: Record<string, unknown> = {
			status,
			updatedAt: new Date().toISOString(),
		};
		if (extra.handoffReason !== undefined)
			payload.handoffReason = extra.handoffReason;
		if (extra.attendantId !== undefined)
			payload.attendantId = extra.attendantId;
		if (extra.closedAt !== undefined) payload.closedAt = extra.closedAt;

		const { error } = await supabase
			.from('pl_support_chat')
			.update(payload)
			.eq('id', chatId);
		if (error) throw new Error(error.message);
	}

	async assignRandomAttendant(chatId: string) {
		const { data: users, error } = await supabase.from('Users').select('id');
		if (error) throw new Error(error.message);
		if (!users || users.length === 0) {
			throw new Error('No attendants available');
		}
		const random = users[Math.floor(Math.random() * users.length)];
		const { error: updateError } = await supabase
			.from('pl_support_chat')
			.update({ attendantId: random.id, updatedAt: new Date().toISOString() })
			.eq('id', chatId);
		if (updateError) throw new Error(updateError.message);
		return random.id as string;
	}

	async getChatById(id: string) {
		const { data: chat, error } = await supabase
			.from('pl_support_chat')
			.select(CHAT_COLS)
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!chat) return null;

		const { data: messages, error: msgError } = await supabase
			.from('pl_support_chat_message')
			.select(MSG_COLS)
			.eq('chatId', id)
			.order('createdAt', { ascending: true });
		if (msgError) throw new Error(msgError.message);

		const attendantName = chat.attendantId
			? await this._userName(chat.attendantId)
			: null;

		return {
			...chat,
			attendantName,
			messages: messages ?? [],
		};
	}

	async listByCustomer(customerId: string) {
		const { data, error } = await supabase
			.from('pl_support_chat')
			.select(CHAT_COLS)
			.eq('customerId', customerId)
			.order('updatedAt', { ascending: false });
		if (error) throw new Error(error.message);
		return this._enrichSummaries(data ?? []);
	}

	async listAll(status?: SupportChatStatus) {
		let query = supabase
			.from('pl_support_chat')
			.select(CHAT_COLS)
			.order('updatedAt', { ascending: false });
		if (status) query = query.eq('status', status);
		const { data, error } = await query;
		if (error) throw new Error(error.message);
		return this._enrichSummaries(data ?? []);
	}

	private async _userName(id: string): Promise<string | null> {
		const { data } = await supabase
			.from('Users')
			.select('name')
			.eq('id', id)
			.maybeSingle();
		return data?.name ?? null;
	}

	private async _enrichSummaries(
		chats: Array<{ attendantId?: string | null } & Record<string, unknown>>,
	) {
		if (chats.length === 0) return [];
		const attendantIds = [
			...new Set(chats.map((c) => c.attendantId).filter(Boolean) as string[]),
		];
		const nameMap: Record<string, string> = {};
		if (attendantIds.length > 0) {
			const { data } = await supabase
				.from('Users')
				.select('id, name')
				.in('id', attendantIds);
			for (const u of data ?? []) nameMap[u.id] = u.name;
		}

		// Chats criados antes da denormalização vêm com lastMessageAt null —
		// resolve a última mensagem on the fly e persiste (backfill one-time).
		const missingIds = chats
			.filter((c) => !c.lastMessageAt)
			.map((c) => c.id as string);
		const lastMap: Record<
			string,
			{ createdAt: string; role: string; content: string }
		> = {};
		if (missingIds.length > 0) {
			const { data: msgs } = await supabase
				.from('pl_support_chat_message')
				.select('chatId, role, content, createdAt')
				.in('chatId', missingIds)
				.order('createdAt', { ascending: false });
			for (const m of msgs ?? []) {
				if (!lastMap[m.chatId]) {
					lastMap[m.chatId] = {
						createdAt: m.createdAt,
						role: m.role,
						content: m.content,
					};
				}
			}
			// Melhor esforço: grava pra não recalcular nas próximas listagens.
			void Promise.allSettled(
				Object.entries(lastMap).map(([chatId, m]) =>
					supabase
						.from('pl_support_chat')
						.update({
							lastMessageAt: m.createdAt,
							lastMessageRole: m.role,
							lastMessagePreview: String(m.content).slice(0, 120),
						})
						.eq('id', chatId)
						.is('lastMessageAt', null),
				),
			);
		}

		return chats.map((c) => {
			const fallback = lastMap[c.id as string];
			return {
				...c,
				attendantName: c.attendantId
					? (nameMap[c.attendantId as string] ?? null)
					: null,
				lastMessageAt: c.lastMessageAt ?? fallback?.createdAt ?? null,
				lastMessageRole: c.lastMessageRole ?? fallback?.role ?? null,
				lastMessagePreview:
					c.lastMessagePreview ??
					(fallback ? String(fallback.content).slice(0, 120) : null),
			};
		});
	}
}

export const supportChatRepository = new SupportChatRepository();
