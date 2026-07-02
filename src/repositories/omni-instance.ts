import { supabase } from '../lib/supabase.js';
import type { OmniInstance } from '../types/omni.js';

const TABLE = 'pl_omni_instance';

class OmniInstanceRepository {
	async create(row: Partial<OmniInstance>): Promise<OmniInstance> {
		const { data, error } = await supabase
			.from(TABLE)
			.insert(row)
			.select('*')
			.single();
		if (error) throw new Error(error.message);
		return data as OmniInstance;
	}

	async findById(id: string): Promise<OmniInstance | null> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as OmniInstance) ?? null;
	}

	async listByOwner(ownerId: string): Promise<OmniInstance[]> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('*')
			.eq('owner_id', ownerId)
			.eq('is_active', true)
			.order('created_at', { ascending: true });
		if (error) throw new Error(error.message);
		return (data ?? []) as OmniInstance[];
	}

	async listAll(): Promise<OmniInstance[]> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('*')
			.eq('is_active', true)
			.order('created_at', { ascending: true });
		if (error) throw new Error(error.message);
		return (data ?? []) as OmniInstance[];
	}

	async update(
		id: string,
		patch: Partial<OmniInstance>,
	): Promise<OmniInstance> {
		const { data, error } = await supabase
			.from(TABLE)
			.update({ ...patch, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select('*')
			.single();
		if (error) throw new Error(error.message);
		return data as OmniInstance;
	}

	async setStatus(
		id: string,
		patch: {
			status?: OmniInstance['status'];
			setup_status?: OmniInstance['setup_status'];
			setup_error?: string | null;
			phone_number?: string | null;
			profile_name?: string | null;
			qr_code?: string | null;
		},
	): Promise<void> {
		const { error } = await supabase
			.from(TABLE)
			.update({ ...patch, updated_at: new Date().toISOString() })
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	async setBillingStatus(
		id: string,
		billing_status: 'ok' | 'no_balance',
	): Promise<void> {
		const { error } = await supabase
			.from(TABLE)
			.update({ billing_status, updated_at: new Date().toISOString() })
			.eq('id', id);
		if (error) throw new Error(error.message);
	}

	async softDelete(id: string): Promise<void> {
		const { error } = await supabase
			.from(TABLE)
			.update({ is_active: false, updated_at: new Date().toISOString() })
			.eq('id', id);
		if (error) throw new Error(error.message);
	}
}

export const omniInstanceRepository = new OmniInstanceRepository();
