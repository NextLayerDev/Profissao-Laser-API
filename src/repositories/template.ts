import { supabase } from '../lib/supabase.js';
import type {
	CreateTemplateInput,
	Template,
	TemplateTipo,
	UpdateTemplateInput,
} from '../types/template.js';

interface ListTemplatesParams {
	page: number;
	limit: number;
	categoryId?: string;
	tipoImagem?: TemplateTipo;
	tag?: string;
	search?: string;
	status?: 'ativo' | 'inativo';
	includeInactive?: boolean;
}

class TemplateRepository {
	async create(
		data: CreateTemplateInput & { id: string; createdBy: string | null },
	): Promise<Template> {
		const { data: record, error } = await supabase
			.from('pl_template')
			.insert(data)
			.select()
			.single();

		if (error || !record) {
			throw new Error(error?.message ?? 'Failed to create template');
		}
		return record as Template;
	}

	async findById(id: string): Promise<Template> {
		const { data, error } = await supabase
			.from('pl_template')
			.select('*')
			.eq('id', id)
			.maybeSingle();

		if (error) throw new Error(error.message);
		if (!data) throw new Error('Template not found');
		return data as Template;
	}

	async list(params: ListTemplatesParams): Promise<{
		data: Template[];
		total: number;
	}> {
		const {
			page,
			limit,
			categoryId,
			tipoImagem,
			tag,
			search,
			status,
			includeInactive,
		} = params;
		const from = (page - 1) * limit;
		const to = from + limit - 1;

		let query = supabase
			.from('pl_template')
			.select('*', { count: 'exact' })
			.order('createdAt', { ascending: false });

		if (status) {
			query = query.eq('status', status);
		} else if (!includeInactive) {
			// Customers only see active by default
			query = query.eq('status', 'ativo');
		}

		if (categoryId) query = query.eq('categoryId', categoryId);
		if (tipoImagem) query = query.eq('tipoImagem', tipoImagem);
		if (tag) query = query.contains('tags', [tag]);
		if (search) {
			query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
		}

		const { data, error, count } = await query.range(from, to);
		if (error) throw new Error(error.message);
		return { data: (data ?? []) as Template[], total: count ?? 0 };
	}

	async update(id: string, data: UpdateTemplateInput): Promise<Template> {
		const { data: record, error } = await supabase
			.from('pl_template')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single();

		if (error || !record) throw new Error('Template not found');
		return record as Template;
	}

	async delete(id: string): Promise<{ imageUrl: string | null }> {
		const { data: existing, error: findError } = await supabase
			.from('pl_template')
			.select('imageUrl')
			.eq('id', id)
			.maybeSingle();

		if (findError) throw new Error(findError.message);
		if (!existing) throw new Error('Template not found');

		const { error: deleteError } = await supabase
			.from('pl_template')
			.delete()
			.eq('id', id);

		if (deleteError) throw new Error(deleteError.message);
		return {
			imageUrl: (existing as { imageUrl: string | null }).imageUrl ?? null,
		};
	}
}

export const templateRepository = new TemplateRepository();
