import { supabase } from '../lib/supabase.js';
import type { ModuleCreate, ModuleUpdate } from '../types/module.js';

class ModuleRepository {
	async create(data: ModuleCreate & { id: string }) {
		const now = new Date().toISOString();
		const { data: module, error } = await supabase
			.from('pl_module')
			.insert({ ...data, createdAt: now, updatedAt: now })
			.select()
			.single();

		if (error) throw new Error(error.message);
		return module;
	}

	async update(id: string, data: ModuleUpdate) {
		const { data: module, error } = await supabase
			.from('pl_module')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
		if (!module) throw new Error('Module not found');
		return module;
	}

	async delete(id: string) {
		const { error } = await supabase.from('pl_module').delete().eq('id', id);
		if (error) throw new Error(error.message);
	}

	async findById(id: string) {
		const { data, error } = await supabase
			.from('pl_module')
			.select('*')
			.eq('id', id)
			.single();

		if (error) throw new Error('Module not found');
		return data;
	}

	async listByProduct(productId: string) {
		const { data, error } = await supabase
			.from('pl_module')
			.select('*')
			.eq('productId', productId)
			.order('order', { ascending: true });

		if (error) throw new Error(error.message);
		return data;
	}

	async reorder(moduleIds: string[]) {
		const now = new Date().toISOString();
		await Promise.all(
			moduleIds.map((id, index) =>
				supabase
					.from('pl_module')
					.update({ order: index, updatedAt: now })
					.eq('id', id),
			),
		);
	}
}

export const moduleRepository = new ModuleRepository();
