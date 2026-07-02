import { supabase } from '../lib/supabase.js';
import type { OmniAgent } from '../types/omni.js';

const TABLE = 'pl_omni_agent';

/**
 * Agentes de IA do OmniResposta (roteador + especialistas) — pl_omni_agent.
 * O banco garante 1 roteador por instância (partial unique) e slug único.
 */
class OmniAgentRepository {
	async listByInstance(
		instanceId: string,
		opts: { enabledOnly?: boolean } = {},
	): Promise<OmniAgent[]> {
		let q = supabase.from(TABLE).select('*').eq('instance_id', instanceId);
		if (opts.enabledOnly) q = q.eq('enabled', true);
		const { data, error } = await q
			.order('role', { ascending: false }) // router primeiro (r > s? não — 'router' < 'specialist'); ordena abaixo
			.order('position', { ascending: true })
			.order('created_at', { ascending: true });
		if (error) throw new Error(error.message);
		const rows = (data ?? []) as OmniAgent[];
		// Router sempre primeiro, depois especialistas por position.
		return rows.sort((a, b) => {
			if (a.role !== b.role) return a.role === 'router' ? -1 : 1;
			return a.position - b.position;
		});
	}

	async findById(id: string): Promise<OmniAgent | null> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as OmniAgent) ?? null;
	}

	async findRouter(instanceId: string): Promise<OmniAgent | null> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('*')
			.eq('instance_id', instanceId)
			.eq('role', 'router')
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as OmniAgent) ?? null;
	}

	async create(row: {
		instance_id: string;
		name: string;
		slug: string;
		role: 'router' | 'specialist';
		system_prompt?: string;
		tool_description?: string;
		model?: string;
		temperature?: number;
		position?: number;
		enabled?: boolean;
	}): Promise<OmniAgent> {
		const { data, error } = await supabase
			.from(TABLE)
			.insert(row)
			.select('*')
			.single();
		if (error) throw new Error(error.message);
		return data as OmniAgent;
	}

	async update(
		id: string,
		patch: Partial<
			Pick<
				OmniAgent,
				| 'name'
				| 'slug'
				| 'system_prompt'
				| 'tool_description'
				| 'model'
				| 'temperature'
				| 'position'
				| 'enabled'
			>
		>,
	): Promise<OmniAgent> {
		const { data, error } = await supabase
			.from(TABLE)
			.update({ ...patch, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select('*')
			.single();
		if (error) throw new Error(error.message);
		return data as OmniAgent;
	}

	async remove(id: string): Promise<void> {
		const { error } = await supabase.from(TABLE).delete().eq('id', id);
		if (error) throw new Error(error.message);
	}

	async countSpecialists(instanceId: string): Promise<number> {
		const { count, error } = await supabase
			.from(TABLE)
			.select('id', { count: 'exact', head: true })
			.eq('instance_id', instanceId)
			.eq('role', 'specialist');
		if (error) throw new Error(error.message);
		return count ?? 0;
	}
}

export const omniAgentRepository = new OmniAgentRepository();
