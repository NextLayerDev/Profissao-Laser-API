import { supabase } from '../lib/supabase.js';
import type { RoleCreate, RoleUpdate } from '../types/role.js';

class RoleRepository {
	async list() {
		const { data, error } = await supabase
			.from('Permissions')
			.select('*')
			.order('id', { ascending: true });
		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async getById(id: number) {
		const { data, error } = await supabase
			.from('Permissions')
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return data;
	}

	async create(data: RoleCreate) {
		const { data: row, error } = await supabase
			.from('Permissions')
			.insert({
				role: data.role,
				label: data.label ?? data.role,
				grants: data.grants ?? [],
				isSuperAdmin: data.isSuperAdmin ?? false,
			})
			.select()
			.single();
		if (error) throw new Error(error.message);
		return row;
	}

	async update(id: number, data: RoleUpdate) {
		const patch: Record<string, unknown> = {};
		if (data.role !== undefined) patch.role = data.role;
		if (data.label !== undefined) patch.label = data.label;
		if (data.grants !== undefined) patch.grants = data.grants;
		if (data.isSuperAdmin !== undefined) patch.isSuperAdmin = data.isSuperAdmin;

		const { data: row, error } = await supabase
			.from('Permissions')
			.update(patch)
			.eq('id', id)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return row;
	}

	/** Quantos usuários usam este cargo (para bloquear exclusão). */
	async countUsers(id: number) {
		const { count, error } = await supabase
			.from('Users')
			.select('id', { count: 'exact', head: true })
			.eq('Permissions', id);
		if (error) throw new Error(error.message);
		return count ?? 0;
	}

	async remove(id: number) {
		const { error } = await supabase.from('Permissions').delete().eq('id', id);
		if (error) throw new Error(error.message);
	}
}

export const roleRepository = new RoleRepository();
