import { startOfTodayBRT } from '../lib/datetime.js';
import { supabase } from '../lib/supabase.js';
import type {
	LaserSettings,
	Previa,
	UpdatePreviaInput,
} from '../types/previa.js';

interface CreatePreviaInput {
	id: string;
	customerId: string;
	name: string;
	productName: string;
	productColor: string | null;
	imagebaseUrl: string;
	imageproductUrl: string;
	imagelogoUrl: string | null;
	previewUrl: string;
	personalizationType: 'logo' | 'text' | 'both';
	customName: string | null;
	instrucoesPersonalizadas: string | null;
	textoLenteDireita: string | null;
	textoLenteEsquerda: string | null;
	modoLentes: boolean;
	laserSettings: LaserSettings;
	notes: string | null;
	prompt: string | null;
	aiModel: string;
}

class PreviaRepository {
	async create(data: CreatePreviaInput): Promise<Previa> {
		const { data: record, error } = await supabase
			.from('pl_previa')
			.insert(data)
			.select()
			.single();

		if (error || !record) {
			throw new Error(error?.message ?? 'Failed to create previa');
		}
		return record as Previa;
	}

	async findByIdAndCustomer(id: string, customerId: string): Promise<Previa> {
		const { data, error } = await supabase
			.from('pl_previa')
			.select('*')
			.eq('id', id)
			.eq('customerId', customerId)
			.maybeSingle();

		if (error) throw new Error(error.message);
		if (!data) throw new Error('Previa not found');
		return data as Previa;
	}

	/** Conta prévias geradas hoje (00:00 BRT em diante) por um customer. */
	async countTodayByCustomer(customerId: string): Promise<number> {
		const startOfDay = startOfTodayBRT();
		const { count, error } = await supabase
			.from('pl_previa')
			.select('*', { count: 'exact', head: true })
			.eq('customerId', customerId)
			.gte('createdAt', startOfDay.toISOString());

		if (error) throw new Error(error.message);
		return count ?? 0;
	}

	async listByCustomer(params: {
		customerId: string;
		page: number;
		limit: number;
	}): Promise<{ data: Previa[]; total: number }> {
		const { customerId, page, limit } = params;
		const from = (page - 1) * limit;
		const to = from + limit - 1;

		const { data, error, count } = await supabase
			.from('pl_previa')
			.select('*', { count: 'exact' })
			.eq('customerId', customerId)
			.order('createdAt', { ascending: false })
			.range(from, to);

		if (error) throw new Error(error.message);
		return {
			data: (data ?? []) as Previa[],
			total: count ?? 0,
		};
	}

	async update(
		id: string,
		customerId: string,
		data: UpdatePreviaInput,
	): Promise<Previa> {
		const { data: record, error } = await supabase
			.from('pl_previa')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.eq('customerId', customerId)
			.select()
			.single();

		if (error || !record) {
			throw new Error('Previa not found');
		}
		return record as Previa;
	}

	async delete(
		id: string,
		customerId: string,
	): Promise<{ previewUrl: string }> {
		const { data: existing, error: findError } = await supabase
			.from('pl_previa')
			.select('previewUrl')
			.eq('id', id)
			.eq('customerId', customerId)
			.maybeSingle();

		if (findError) throw new Error(findError.message);
		if (!existing) throw new Error('Previa not found');

		const { error: deleteError } = await supabase
			.from('pl_previa')
			.delete()
			.eq('id', id)
			.eq('customerId', customerId);

		if (deleteError) throw new Error(deleteError.message);
		return { previewUrl: (existing as { previewUrl: string }).previewUrl };
	}
}

export const previaRepository = new PreviaRepository();
