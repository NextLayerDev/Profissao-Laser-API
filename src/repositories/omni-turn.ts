import { supabase } from '../lib/supabase.js';
import type { OmniTurn } from '../types/omni.js';

const TABLE = 'pl_omni_turn';

class OmniTurnRepository {
	/**
	 * Tenta iniciar um turno (lock de DB): o partial unique
	 * `pl_omni_turn_running_uniq (chat_id) where status='running'` garante 1
	 * turno ativo por chat mesmo sem Redis. 23505 → null (ocupado).
	 */
	async tryStart(
		chatId: string,
		instanceId: string,
		inputMessageIds: string[],
	): Promise<OmniTurn | null> {
		const { data, error } = await supabase
			.from(TABLE)
			.insert({
				chat_id: chatId,
				instance_id: instanceId,
				status: 'running',
				input_message_ids: inputMessageIds,
			})
			.select('*')
			.single();
		if (error) {
			if (error.code === '23505') return null;
			throw new Error(error.message);
		}
		return data as OmniTurn;
	}

	async finish(
		id: string,
		status: 'done' | 'failed' | 'no_balance',
		extra: {
			output_message_id?: string | null;
			model?: string | null;
			prompt_tokens?: number | null;
			completion_tokens?: number | null;
			voxxys_charged?: number;
			error?: string | null;
		} = {},
	): Promise<void> {
		const { error } = await supabase
			.from(TABLE)
			.update({
				status,
				finished_at: new Date().toISOString(),
				...extra,
			})
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	/** Turnos 'running' órfãos (crash) — a varredura finaliza como failed. */
	async listStaleRunning(olderThanMs: number): Promise<OmniTurn[]> {
		const cutoff = new Date(Date.now() - olderThanMs).toISOString();
		const { data, error } = await supabase
			.from(TABLE)
			.select('*')
			.eq('status', 'running')
			.lt('created_at', cutoff);
		if (error) throw new Error(error.message);
		return (data ?? []) as OmniTurn[];
	}

	async listRecent(instanceId: string, limit = 50): Promise<OmniTurn[]> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('*')
			.eq('instance_id', instanceId)
			.order('created_at', { ascending: false })
			.limit(limit);
		if (error) throw new Error(error.message);
		return (data ?? []) as OmniTurn[];
	}
}

export const omniTurnRepository = new OmniTurnRepository();
