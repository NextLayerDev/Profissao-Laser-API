import { supabase } from '../lib/supabase.js';
import type {
	CreateVectorizeHelpInput,
	UpdateVectorizeHelpInput,
	VectorizeHelp,
} from '../types/vectorize-help.js';

interface CreateRow extends CreateVectorizeHelpInput {
	id: string;
	order: number;
}

class VectorizeHelpRepository {
	async listAll(): Promise<VectorizeHelp[]> {
		const { data, error } = await supabase
			.from('pl_vectorize_help')
			.select('*')
			.order('order', { ascending: true });

		if (error) throw new Error(error.message);
		return (data ?? []) as VectorizeHelp[];
	}

	async listActive(): Promise<VectorizeHelp[]> {
		const { data, error } = await supabase
			.from('pl_vectorize_help')
			.select('*')
			.eq('active', true)
			.order('order', { ascending: true });

		if (error) throw new Error(error.message);
		return (data ?? []) as VectorizeHelp[];
	}

	async findById(id: string): Promise<VectorizeHelp> {
		const { data, error } = await supabase
			.from('pl_vectorize_help')
			.select('*')
			.eq('id', id)
			.maybeSingle();

		if (error) throw new Error(error.message);
		if (!data) throw new Error('Vectorize help not found');
		return data as VectorizeHelp;
	}

	async countAll(): Promise<number> {
		const { count, error } = await supabase
			.from('pl_vectorize_help')
			.select('*', { count: 'exact', head: true });

		if (error) throw new Error(error.message);
		return count ?? 0;
	}

	async create(data: CreateRow): Promise<VectorizeHelp> {
		const { data: record, error } = await supabase
			.from('pl_vectorize_help')
			.insert(data)
			.select()
			.single();

		if (error || !record) {
			throw new Error(error?.message ?? 'Failed to create vectorize help');
		}
		return record as VectorizeHelp;
	}

	async update(
		id: string,
		data: UpdateVectorizeHelpInput,
	): Promise<VectorizeHelp> {
		const { data: record, error } = await supabase
			.from('pl_vectorize_help')
			.update({ ...data, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single();

		if (error || !record) throw new Error('Vectorize help not found');
		return record as VectorizeHelp;
	}

	async delete(id: string): Promise<void> {
		const { data: existing, error: findError } = await supabase
			.from('pl_vectorize_help')
			.select('id')
			.eq('id', id)
			.maybeSingle();

		if (findError) throw new Error(findError.message);
		if (!existing) throw new Error('Vectorize help not found');

		const { error } = await supabase
			.from('pl_vectorize_help')
			.delete()
			.eq('id', id);

		if (error) throw new Error(error.message);
	}

	/** Atualiza o `order` de cada item conforme o índice no array de ids. */
	async reorder(ids: string[]): Promise<void> {
		const results = await Promise.all(
			ids.map((id, index) =>
				supabase
					.from('pl_vectorize_help')
					.update({ order: index, updated_at: new Date().toISOString() })
					.eq('id', id),
			),
		);
		const failed = results.find((r) => r.error);
		if (failed?.error) throw new Error(failed.error.message);
	}
}

export const vectorizeHelpRepository = new VectorizeHelpRepository();
