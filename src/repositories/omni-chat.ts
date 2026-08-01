import { supabase } from '../lib/supabase.js';
import type { OmniChat, OmniContact } from '../types/omni.js';

const CONTACTS = 'pl_omni_contact';
const CHATS = 'pl_omni_chat';

export interface ListChatsOpts {
	search?: string;
	filter?: 'all' | 'ia' | 'human';
	leadStep?: string;
	archived?: boolean;
	pinned?: boolean;
	limit?: number;
	/** cursor = last_message_at ISO da última linha da página anterior */
	cursor?: string;
}

class OmniChatRepository {
	async upsertContact(
		instanceId: string,
		waId: string,
		info: {
			name?: string | null;
			push_name?: string | null;
			profile_pic_url?: string | null;
		},
	): Promise<OmniContact> {
		const patch: Record<string, unknown> = {
			instance_id: instanceId,
			wa_id: waId,
			updated_at: new Date().toISOString(),
		};
		if (info.name) patch.name = info.name;
		if (info.push_name) patch.push_name = info.push_name;
		if (info.profile_pic_url) patch.profile_pic_url = info.profile_pic_url;
		const { data, error } = await supabase
			.from(CONTACTS)
			.upsert(patch, { onConflict: 'instance_id,wa_id' })
			.select('*')
			.single();
		if (error) throw new Error(error.message);
		return data as OmniContact;
	}

	/** Cria o chat se não existir; NÃO sobrescreve assigned/pins/etc. */
	async upsertChat(
		instanceId: string,
		contactId: string,
		waChatId: string,
	): Promise<OmniChat> {
		const existing = await this.findByWaChatId(instanceId, waChatId);
		if (existing) return existing;
		const { data, error } = await supabase
			.from(CHATS)
			.insert({
				instance_id: instanceId,
				contact_id: contactId,
				wa_chat_id: waChatId,
			})
			.select('*')
			.single();
		if (error) {
			// corrida: outro webhook criou primeiro
			if (error.code === '23505') {
				const again = await this.findByWaChatId(instanceId, waChatId);
				if (again) return again;
			}
			throw new Error(error.message);
		}
		return data as OmniChat;
	}

	async findById(chatId: string): Promise<OmniChat | null> {
		const { data, error } = await supabase
			.from(CHATS)
			.select('*, contact:pl_omni_contact(*)')
			.eq('id', chatId)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as OmniChat) ?? null;
	}

	async findByWaChatId(
		instanceId: string,
		waChatId: string,
	): Promise<OmniChat | null> {
		const { data, error } = await supabase
			.from(CHATS)
			.select('*')
			.eq('instance_id', instanceId)
			.eq('wa_chat_id', waChatId)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as OmniChat) ?? null;
	}

	async listChats(
		instanceId: string,
		opts: ListChatsOpts,
	): Promise<OmniChat[]> {
		const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
		let q = supabase
			.from(CHATS)
			.select('*, contact:pl_omni_contact(*)')
			.eq('instance_id', instanceId)
			.eq('is_archived', opts.archived === true);
		if (opts.filter === 'ia') q = q.eq('assigned_to', 'ai');
		if (opts.filter === 'human') q = q.eq('assigned_to', 'human');
		if (opts.leadStep) q = q.eq('lead_step', opts.leadStep);
		if (opts.pinned === true) q = q.eq('is_pinned', true);
		if (opts.cursor) q = q.lt('last_message_at', opts.cursor);
		const { data, error } = await q
			.order('is_pinned', { ascending: false })
			.order('last_message_at', { ascending: false, nullsFirst: false })
			.limit(limit);
		if (error) throw new Error(error.message);
		let rows = (data ?? []) as OmniChat[];
		if (opts.search?.trim()) {
			const s = opts.search.trim().toLowerCase();
			rows = rows.filter((c) => {
				const contact = c.contact;
				return (
					c.wa_chat_id.toLowerCase().includes(s) ||
					(contact?.name ?? '').toLowerCase().includes(s) ||
					(contact?.push_name ?? '').toLowerCase().includes(s) ||
					(c.last_message ?? '').toLowerCase().includes(s)
				);
			});
		}
		return rows;
	}

	async updateChat(
		chatId: string,
		patch: Partial<
			Pick<
				OmniChat,
				| 'is_pinned'
				| 'is_archived'
				| 'lead_step'
				| 'ia_paused'
				| 'status'
				| 'assigned_to'
				| 'assigned_user_id'
				| 'assigned_user_name'
			>
		>,
	): Promise<OmniChat> {
		const { data, error } = await supabase
			.from(CHATS)
			.update({ ...patch, updated_at: new Date().toISOString() })
			.eq('id', chatId)
			.select('*, contact:pl_omni_contact(*)')
			.single();
		if (error) throw new Error(error.message);
		return data as OmniChat;
	}

	async bumpInbound(chatId: string, preview: string): Promise<void> {
		// unread via RPC não existe; lê+escreve (corrida aceitável: contador visual)
		const { data } = await supabase
			.from(CHATS)
			.select('unread_count')
			.eq('id', chatId)
			.maybeSingle();
		const unread = ((data?.unread_count as number) ?? 0) + 1;
		const { error } = await supabase
			.from(CHATS)
			.update({
				unread_count: unread,
				last_message: preview.slice(0, 300),
				last_message_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})
			.eq('id', chatId);
		if (error) throw new Error(error.message);
	}

	async bumpOutbound(chatId: string, preview: string): Promise<void> {
		const { error } = await supabase
			.from(CHATS)
			.update({
				last_message: preview.slice(0, 300),
				last_message_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})
			.eq('id', chatId);
		if (error) throw new Error(error.message);
	}

	async resetUnread(chatId: string): Promise<void> {
		const { error } = await supabase
			.from(CHATS)
			.update({ unread_count: 0, updated_at: new Date().toISOString() })
			.eq('id', chatId);
		if (error) throw new Error(error.message);
	}

	async transferAll(instanceId: string, to: 'ai'): Promise<number> {
		const { data, error } = await supabase
			.from(CHATS)
			.update({
				assigned_to: to,
				assigned_user_id: null,
				assigned_user_name: null,
				updated_at: new Date().toISOString(),
			})
			.eq('instance_id', instanceId)
			.neq('assigned_to', to)
			.select('id');
		if (error) throw new Error(error.message);
		return (data ?? []).length;
	}

	async stats(instanceId: string): Promise<{
		total: number;
		ia: number;
		human: number;
		unread: number;
		by_lead_step: Record<string, number>;
	}> {
		const { data, error } = await supabase
			.from(CHATS)
			.select('assigned_to, unread_count, lead_step')
			.eq('instance_id', instanceId)
			.eq('is_archived', false);
		if (error) throw new Error(error.message);
		const rows = (data ?? []) as Array<{
			assigned_to: string;
			unread_count: number;
			lead_step: string | null;
		}>;
		const by_lead_step: Record<string, number> = {};
		let ia = 0;
		let human = 0;
		let unread = 0;
		for (const r of rows) {
			if (r.assigned_to === 'ai') ia++;
			else human++;
			if (r.unread_count > 0) unread++;
			if (r.lead_step) {
				by_lead_step[r.lead_step] = (by_lead_step[r.lead_step] ?? 0) + 1;
			}
		}
		return { total: rows.length, ia, human, unread, by_lead_step };
	}

	/** Chats com mensagens pendentes de IA há mais de N ms (varredura). */
	async listChatsWithStalePending(olderThanMs: number): Promise<string[]> {
		const cutoff = new Date(Date.now() - olderThanMs).toISOString();
		const { data, error } = await supabase
			.from('pl_omni_message')
			.select('chat_id')
			.eq('ai_state', 'pending')
			.lt('created_at', cutoff)
			.limit(200);
		if (error) throw new Error(error.message);
		return [
			...new Set(
				((data ?? []) as Array<{ chat_id: string }>).map((r) => r.chat_id),
			),
		];
	}
}

export const omniChatRepository = new OmniChatRepository();
