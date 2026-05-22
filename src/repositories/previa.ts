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

	/**
	 * Stats globais de uso da feature de prévias IA (admin):
	 *  - generatedToday: nº de prévias geradas hoje (00:00 BRT em diante)
	 *  - activeUsersToday: customers distintos que geraram hoje
	 *  - totalUsers: customers distintos que já geraram ao menos uma prévia
	 */
	async getUsageStats(): Promise<{
		generatedToday: number;
		activeUsersToday: number;
		totalUsers: number;
	}> {
		const startOfDay = startOfTodayBRT();

		const { count: generatedToday, error: e1 } = await supabase
			.from('pl_previa')
			.select('*', { count: 'exact', head: true })
			.gte('createdAt', startOfDay.toISOString());
		if (e1) throw new Error(e1.message);

		const { data: todayRows, error: e2 } = await supabase
			.from('pl_previa')
			.select('customerId')
			.gte('createdAt', startOfDay.toISOString())
			.range(0, 9999);
		if (e2) throw new Error(e2.message);
		const activeUsersToday = new Set(
			(todayRows ?? []).map((r) => (r as { customerId: string }).customerId),
		).size;

		const { data: allRows, error: e3 } = await supabase
			.from('pl_previa')
			.select('customerId')
			.range(0, 9999);
		if (e3) throw new Error(e3.message);
		const totalUsers = new Set(
			(allRows ?? []).map((r) => (r as { customerId: string }).customerId),
		).size;

		return {
			generatedToday: generatedToday ?? 0,
			activeUsersToday,
			totalUsers,
		};
	}

	/**
	 * Lista paginada de customers que geraram prévias, com:
	 *  - totalPrevias (lifetime)
	 *  - todayPrevias (hoje, BRT)
	 *  - lastGeneratedAt
	 *  - name + email do customer (join com Customers)
	 * Suporta busca por nome ou email.
	 */
	async listUsageUsers(params: {
		page: number;
		limit: number;
		search?: string;
	}): Promise<{
		data: Array<{
			customerId: string;
			name: string | null;
			email: string | null;
			totalPrevias: number;
			todayPrevias: number;
			lastGeneratedAt: string;
		}>;
		total: number;
	}> {
		const { page, limit, search } = params;
		const startOfDay = startOfTodayBRT();
		const startOfDayMs = startOfDay.getTime();

		// 1. Fetch all previa rows (just customerId + createdAt) e agrega em JS.
		// Limita a 10k pra evitar fetch gigante; se passar, paginar internamente.
		const { data: previaRows, error: e1 } = await supabase
			.from('pl_previa')
			.select('customerId, createdAt')
			.range(0, 9999);
		if (e1) throw new Error(e1.message);

		const byCustomer = new Map<
			string,
			{ total: number; today: number; lastAt: string }
		>();
		for (const row of (previaRows ?? []) as Array<{
			customerId: string;
			createdAt: string;
		}>) {
			const existing = byCustomer.get(row.customerId) ?? {
				total: 0,
				today: 0,
				lastAt: row.createdAt,
			};
			existing.total += 1;
			if (new Date(row.createdAt).getTime() >= startOfDayMs) {
				existing.today += 1;
			}
			if (row.createdAt > existing.lastAt) existing.lastAt = row.createdAt;
			byCustomer.set(row.customerId, existing);
		}

		const customerIds = Array.from(byCustomer.keys());
		if (customerIds.length === 0) {
			return { data: [], total: 0 };
		}

		// 2. Fetch nome/email dos customers (join). Customers.id pode ser
		// `string` (uuid de auth supabase) ou outro formato — só usamos in().
		const { data: customers, error: e2 } = await supabase
			.from('Customers')
			.select('id, name, email')
			.in('id', customerIds);
		if (e2) throw new Error(e2.message);
		const customerById = new Map(
			(
				(customers ?? []) as Array<{
					id: string;
					name: string | null;
					email: string | null;
				}>
			).map((c) => [c.id, c]),
		);

		// 3. Monta lista completa
		let list = Array.from(byCustomer.entries()).map(([customerId, stats]) => {
			const c = customerById.get(customerId);
			return {
				customerId,
				name: c?.name ?? null,
				email: c?.email ?? null,
				totalPrevias: stats.total,
				todayPrevias: stats.today,
				lastGeneratedAt: stats.lastAt,
			};
		});

		// 4. Filtro por busca (nome/email/customerId — fuzzy contains)
		if (search) {
			const q = search.trim().toLowerCase();
			if (q) {
				list = list.filter(
					(u) =>
						(u.name?.toLowerCase().includes(q) ?? false) ||
						(u.email?.toLowerCase().includes(q) ?? false) ||
						u.customerId.toLowerCase().includes(q),
				);
			}
		}

		// 5. Sort por última atividade desc
		list.sort((a, b) => b.lastGeneratedAt.localeCompare(a.lastGeneratedAt));

		// 6. Paginação
		const total = list.length;
		const start = (page - 1) * limit;
		const data = list.slice(start, start + limit);

		return { data, total };
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
