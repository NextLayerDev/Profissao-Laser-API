import { supabase } from '../lib/supabase.js';
import type {
	CreateKnowledgeBase,
	ListKnowledgeBaseQuery,
	UpdateKnowledgeBase,
} from '../types/knowledge-base.js';

class KnowledgeBaseRepository {
	async list(filters: ListKnowledgeBaseQuery) {
		let query = supabase
			.from('pl_knowledge_base_article')
			.select('*')
			.eq('isPublished', true)
			.order('order', { ascending: true });

		if (filters.category) query = query.eq('category', filters.category);
		if (filters.type) query = query.eq('type', filters.type);
		if (filters.search) {
			query = query.or(
				`title.ilike.%${filters.search}%,excerpt.ilike.%${filters.search}%`,
			);
		}

		const { data, error } = await query;
		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async findById(id: string) {
		const { data, error } = await supabase
			.from('pl_knowledge_base_article')
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return data;
	}

	async create(data: CreateKnowledgeBase) {
		const { data: row, error } = await supabase
			.from('pl_knowledge_base_article')
			.insert(data)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return row;
	}

	async update(id: string, data: UpdateKnowledgeBase) {
		const { data: row, error } = await supabase
			.from('pl_knowledge_base_article')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return row;
	}

	async delete(id: string) {
		const { error } = await supabase
			.from('pl_knowledge_base_article')
			.delete()
			.eq('id', id);
		if (error) throw new Error(error.message);
	}
}

export const knowledgeBaseRepository = new KnowledgeBaseRepository();
