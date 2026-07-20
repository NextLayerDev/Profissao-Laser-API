import { uploadSvgFile } from '../lib/storage.js';
import { supabaseUpvox as supabase } from '../lib/supabase-upvox.js';

interface ListOptions {
	page: number;
	limit: number;
	search?: string;
}

class VectorRepository {
	async list(customerId: string, { page, limit, search }: ListOptions) {
		const offset = (page - 1) * limit;

		let query = supabase
			.from('customer_vectors')
			.select('*', { count: 'exact' })
			.eq('customer_id', customerId)
			.order('created_at', { ascending: false })
			.range(offset, offset + limit - 1);

		if (search) {
			query = query.ilike('original_name', `%${search}%`);
		}

		const { data, error, count } = await query;

		if (error) throw new Error(error.message);

		return { data: data ?? [], total: count ?? 0 };
	}

	async findById(id: string) {
		const { data, error } = await supabase
			.from('customer_vectors')
			.select('*')
			.eq('id', id)
			.single();

		if (error || !data) throw new Error('Vector not found');

		return data;
	}

	async create(
		customerId: string,
		fields: {
			original_name: string;
			svg_url: string;
			original_url?: string;
			params?: Record<string, unknown>;
			png_url?: string;
		},
	) {
		const { data, error } = await supabase
			.from('customer_vectors')
			.insert({ customer_id: customerId, ...fields })
			.select()
			.single();

		if (error) throw new Error(error.message);
		return data;
	}

	/**
	 * Marca um conjunto de formatos como pagos de uma vez (usado pela line-art com
	 * IA, cobrada NA GERAÇÃO → todos os formatos já saem pagos, download não recobra).
	 */
	async setPaidFormats(
		id: string,
		customerId: string,
		formats: string[],
	): Promise<string[]> {
		const { data, error } = await supabase
			.from('customer_vectors')
			.update({ paid_formats: formats, updated_at: new Date().toISOString() })
			.eq('id', id)
			.eq('customer_id', customerId)
			.select('paid_formats')
			.single();
		if (error || !data) throw new Error(error?.message ?? 'Vector not found');
		return data.paid_formats ?? formats;
	}

	/**
	 * Guarda (ou atualiza) o vetor INVERTIDO de `parentId` como um registro
	 * próprio em "Meus vetores".
	 *
	 * Idempotente por (pai, modo) via marcador em `params`: alternar a polaridade
	 * várias vezes atualiza o mesmo registro em vez de encher a biblioteca de
	 * duplicatas. `paid_formats` vem do pai — é o mesmo vetor, não pode recobrar.
	 */
	async upsertInverted(
		customerId: string,
		input: {
			parentId: string;
			mode: string;
			originalName: string;
			svgContent: string;
			pngUrl: string;
			paidFormats: string[];
			params: Record<string, unknown>;
		},
	): Promise<string> {
		const marker = {
			...input.params,
			invertedFrom: input.parentId,
			invertMode: input.mode,
		};

		const { data: existing } = await supabase
			.from('customer_vectors')
			.select('id')
			.eq('customer_id', customerId)
			.eq('params->>invertedFrom', input.parentId)
			.eq('params->>invertMode', input.mode)
			.maybeSingle();

		const svgUrl = await uploadSvgFile(
			input.svgContent,
			`${customerId}/${input.parentId}_inverted_${input.mode}.svg`,
		);

		if (existing?.id) {
			const { error } = await supabase
				.from('customer_vectors')
				.update({
					svg_url: svgUrl,
					png_url: input.pngUrl,
					paid_formats: input.paidFormats,
					updated_at: new Date().toISOString(),
				})
				.eq('id', existing.id)
				.eq('customer_id', customerId);
			if (error) throw new Error(error.message);
			return existing.id;
		}

		const { data, error } = await supabase
			.from('customer_vectors')
			.insert({
				customer_id: customerId,
				original_name: input.originalName,
				svg_url: svgUrl,
				png_url: input.pngUrl,
				params: marker,
				paid_formats: input.paidFormats,
			})
			.select('id')
			.single();
		if (error || !data) throw new Error(error?.message ?? 'Insert failed');
		return data.id;
	}

	async findByIdForExport(id: string, customerId: string | null) {
		const { data, error } = await supabase
			.from('customer_vectors')
			.select('*')
			.eq('id', id)
			.single();

		if (error || !data) throw new Error('Vector not found');
		if (customerId && data.customer_id !== customerId)
			throw new Error('Vector not found');
		return data;
	}

	/**
	 * Marca um formato (svg/png/dxf) como PAGO para este vetor (idempotente, união).
	 * É a fonte de verdade da cobrança-por-formato: garante que re-download do mesmo
	 * formato — inclusive da biblioteca, cross-session — não cobra de novo.
	 * Escopado ao dono. Devolve a lista atualizada de formatos pagos.
	 */
	async markFormatPaid(
		id: string,
		customerId: string,
		format: string,
	): Promise<string[]> {
		const { data: row, error: findErr } = await supabase
			.from('customer_vectors')
			.select('paid_formats')
			.eq('id', id)
			.eq('customer_id', customerId)
			.single();

		if (findErr || !row) throw new Error('Vector not found');

		const paid_formats = Array.from(
			new Set<string>([...(row.paid_formats ?? []), format]),
		);

		const { data, error } = await supabase
			.from('customer_vectors')
			.update({ paid_formats, updated_at: new Date().toISOString() })
			.eq('id', id)
			.eq('customer_id', customerId)
			.select('paid_formats')
			.single();

		if (error || !data) throw new Error(error?.message ?? 'Vector not found');
		return data.paid_formats ?? paid_formats;
	}

	async update(
		id: string,
		fields: { original_name?: string; svg_url?: string },
	) {
		const { data, error } = await supabase
			.from('customer_vectors')
			.update({ ...fields, updated_at: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return data;
	}

	async delete(id: string) {
		const { data, error: findError } = await supabase
			.from('customer_vectors')
			.select('*')
			.eq('id', id)
			.single();

		if (findError || !data) throw new Error('Vector not found');

		const { error } = await supabase
			.from('customer_vectors')
			.delete()
			.eq('id', id);

		if (error) throw new Error(error.message);

		return data;
	}
}

export const vectorRepository = new VectorRepository();
