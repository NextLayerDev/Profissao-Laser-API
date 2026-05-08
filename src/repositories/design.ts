import { supabase } from '../lib/supabase.js';
import type {
	CreateDesignInput,
	Design,
	UpdateDesignInput,
} from '../types/design.js';

interface ListDesignsParams {
	customerId: string;
	page: number;
	limit: number;
	templateId?: string;
	search?: string;
}

class DesignRepository {
	async create(
		data: CreateDesignInput & { id: string; customerId: string },
	): Promise<Design> {
		const { data: record, error } = await supabase
			.from('pl_design')
			.insert(data)
			.select()
			.single();

		if (error || !record) {
			throw new Error(error?.message ?? 'Failed to create design');
		}
		return record as Design;
	}

	async findByIdAndCustomer(id: string, customerId: string): Promise<Design> {
		const { data, error } = await supabase
			.from('pl_design')
			.select('*')
			.eq('id', id)
			.eq('customerId', customerId)
			.maybeSingle();

		if (error) throw new Error(error.message);
		if (!data) throw new Error('Design not found');
		return data as Design;
	}

	async listByCustomer(params: ListDesignsParams): Promise<{
		data: Design[];
		total: number;
	}> {
		const { customerId, page, limit, templateId, search } = params;
		const from = (page - 1) * limit;
		const to = from + limit - 1;

		let query = supabase
			.from('pl_design')
			.select('*', { count: 'exact' })
			.eq('customerId', customerId)
			.order('updatedAt', { ascending: false });

		if (templateId) query = query.eq('templateId', templateId);
		if (search) {
			query = query.or(`name.ilike.%${search}%,notes.ilike.%${search}%`);
		}

		const { data, error, count } = await query.range(from, to);
		if (error) throw new Error(error.message);
		return { data: (data ?? []) as Design[], total: count ?? 0 };
	}

	async update(
		id: string,
		customerId: string,
		data: UpdateDesignInput,
	): Promise<Design> {
		const { data: record, error } = await supabase
			.from('pl_design')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.eq('customerId', customerId)
			.select()
			.single();

		if (error || !record) throw new Error('Design not found');
		return record as Design;
	}

	async updateThumbnail(
		id: string,
		customerId: string,
		thumbnailUrl: string,
	): Promise<Design> {
		const { data: record, error } = await supabase
			.from('pl_design')
			.update({ thumbnailUrl, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.eq('customerId', customerId)
			.select()
			.single();

		if (error || !record) throw new Error('Design not found');
		return record as Design;
	}

	async delete(
		id: string,
		customerId: string,
	): Promise<{ thumbnailUrl: string | null }> {
		const { data: existing, error: findError } = await supabase
			.from('pl_design')
			.select('thumbnailUrl')
			.eq('id', id)
			.eq('customerId', customerId)
			.maybeSingle();

		if (findError) throw new Error(findError.message);
		if (!existing) throw new Error('Design not found');

		const { error: deleteError } = await supabase
			.from('pl_design')
			.delete()
			.eq('id', id)
			.eq('customerId', customerId);

		if (deleteError) throw new Error(deleteError.message);
		return {
			thumbnailUrl:
				(existing as { thumbnailUrl: string | null }).thumbnailUrl ?? null,
		};
	}
}

export const designRepository = new DesignRepository();
