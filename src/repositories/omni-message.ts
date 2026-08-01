import { supabase } from '../lib/supabase.js';
import type { OmniMessage } from '../types/omni.js';

const TABLE = 'pl_omni_message';

class OmniMessageRepository {
	/**
	 * Insere mensagem inbound com DEDUPE por (instance_id, provider_message_id)
	 * — retry de webhook devolve null (já processada).
	 */
	async insertInbound(row: Partial<OmniMessage>): Promise<OmniMessage | null> {
		const { data, error } = await supabase
			.from(TABLE)
			.upsert(row, {
				onConflict: 'instance_id,provider_message_id',
				ignoreDuplicates: true,
			})
			.select('*')
			.maybeSingle();
		if (error) {
			// alguns PostgREST retornam 23505 mesmo com ignoreDuplicates em índice parcial
			if (error.code === '23505') return null;
			throw new Error(error.message);
		}
		return (data as OmniMessage) ?? null;
	}

	/** Mensagem de saída (IA/humano). Aceita id pré-gerado (billing ref_id). */
	async insertOutbound(row: Partial<OmniMessage>): Promise<OmniMessage> {
		const { data, error } = await supabase
			.from(TABLE)
			.insert(row)
			.select('*')
			.single();
		if (error) throw new Error(error.message);
		return data as OmniMessage;
	}

	async listByChat(
		chatId: string,
		opts: { before?: string; limit?: number },
	): Promise<OmniMessage[]> {
		const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
		let q = supabase.from(TABLE).select('*').eq('chat_id', chatId);
		if (opts.before) q = q.lt('wa_timestamp', opts.before);
		const { data, error } = await q
			.order('wa_timestamp', { ascending: false })
			.limit(limit);
		if (error) throw new Error(error.message);
		return ((data ?? []) as OmniMessage[]).reverse();
	}

	async lastN(chatId: string, n: number): Promise<OmniMessage[]> {
		return this.listByChat(chatId, { limit: n });
	}

	async updateStatusByProviderId(
		instanceId: string,
		providerMessageId: string,
		status: 'sent' | 'delivered' | 'read',
	): Promise<string | null> {
		const { data, error } = await supabase
			.from(TABLE)
			.update({ status })
			.eq('instance_id', instanceId)
			.eq('provider_message_id', providerMessageId)
			.select('chat_id')
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data?.chat_id as string) ?? null;
	}

	async listPending(chatId: string): Promise<OmniMessage[]> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('*')
			.eq('chat_id', chatId)
			.eq('ai_state', 'pending')
			.order('wa_timestamp', { ascending: true });
		if (error) throw new Error(error.message);
		return (data ?? []) as OmniMessage[];
	}

	async hasPending(chatId: string): Promise<boolean> {
		const { count, error } = await supabase
			.from(TABLE)
			.select('id', { count: 'exact', head: true })
			.eq('chat_id', chatId)
			.eq('ai_state', 'pending');
		if (error) throw new Error(error.message);
		return (count ?? 0) > 0;
	}

	async oldestPendingAgeMs(chatId: string): Promise<number> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('created_at')
			.eq('chat_id', chatId)
			.eq('ai_state', 'pending')
			.order('created_at', { ascending: true })
			.limit(1)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data?.created_at) return 0;
		return Date.now() - new Date(data.created_at as string).getTime();
	}

	async markConsumed(ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const { error } = await supabase
			.from(TABLE)
			.update({ ai_state: 'consumed' })
			.in('id', ids);
		if (error) throw new Error(error.message);
	}

	async markSkipped(ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const { error } = await supabase
			.from(TABLE)
			.update({ ai_state: 'skipped' })
			.in('id', ids);
		if (error) throw new Error(error.message);
	}

	async setTranscription(id: string, text: string): Promise<void> {
		const { error } = await supabase
			.from(TABLE)
			.update({ transcription: text })
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	async setMediaUrl(id: string, url: string): Promise<void> {
		const { error } = await supabase
			.from(TABLE)
			.update({ media_url: url })
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	async findById(id: string): Promise<OmniMessage | null> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as OmniMessage) ?? null;
	}

	/** Última inbound do chat (mark-read no provedor). */
	async lastInbound(chatId: string): Promise<OmniMessage | null> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('*')
			.eq('chat_id', chatId)
			.eq('direction', 'in')
			.order('wa_timestamp', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as OmniMessage) ?? null;
	}
}

export const omniMessageRepository = new OmniMessageRepository();
