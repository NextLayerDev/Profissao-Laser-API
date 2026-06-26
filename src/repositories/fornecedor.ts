import { supabase } from '../lib/supabase.js';
import type {
	CreateFornecedor,
	Fornecedor,
	UpdateFornecedor,
} from '../types/fornecedor.js';

class FornecedorRepository {
	async list(): Promise<Fornecedor[]> {
		const { data, error } = await supabase
			.from('pl_fornecedor')
			.select('*')
			.order('order', { ascending: true })
			.order('createdAt', { ascending: true });
		if (error) throw new Error(error.message);
		return (data ?? []) as Fornecedor[];
	}

	async create(input: CreateFornecedor): Promise<Fornecedor> {
		// Sem `order` explícito, anexa no fim da lista (em vez do default 0, que
		// jogaria o novo fornecedor pro topo).
		let order = input.order;
		if (order === undefined) {
			const { data: last } = await supabase
				.from('pl_fornecedor')
				.select('order')
				.order('order', { ascending: false })
				.limit(1)
				.maybeSingle();
			order = ((last?.order as number | null | undefined) ?? 0) + 1;
		}
		const { data, error } = await supabase
			.from('pl_fornecedor')
			.insert({ ...input, order, updatedAt: new Date().toISOString() })
			.select()
			.single();
		if (error) throw new Error(error.message);
		return data as Fornecedor;
	}

	async update(id: string, patch: UpdateFornecedor): Promise<Fornecedor> {
		const { data, error } = await supabase
			.from('pl_fornecedor')
			.update({ ...patch, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.select()
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) throw new Error('Fornecedor not found');
		return data as Fornecedor;
	}

	async delete(id: string): Promise<void> {
		const { error } = await supabase
			.from('pl_fornecedor')
			.delete()
			.eq('id', id);
		if (error) throw new Error(error.message);
	}
}

export const fornecedorRepository = new FornecedorRepository();
