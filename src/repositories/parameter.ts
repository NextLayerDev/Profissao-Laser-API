import { supabase } from '../lib/supabase.js';
import type {
	CommunityListQuery,
	CreateParameter,
	ListParametersQuery,
	UpdateParameter,
} from '../types/parameter.js';

class ParameterRepository {
	private applyFilters<
		T extends {
			eq: (...args: never) => unknown;
			ilike: (...args: never) => unknown;
			or: (...args: never) => unknown;
		},
	>(query: T, filters: Partial<ListParametersQuery>): T {
		let q = query;
		if (filters.machine) q = q.ilike('machine', `%${filters.machine}%`) as T;
		if (filters.model) q = q.ilike('machine', `%${filters.model}%`) as T;
		if (filters.material) q = q.eq('material', filters.material) as T;
		if (filters.thickness) q = q.eq('thickness', filters.thickness) as T;
		if (filters.mode) q = q.eq('mode', filters.mode) as T;
		if (filters.search) {
			q = q.or(
				`material.ilike.%${filters.search}%,materialType.ilike.%${filters.search}%,machine.ilike.%${filters.search}%`,
			) as T;
		}
		return q;
	}

	async list(filters: ListParametersQuery, createdBy?: string) {
		const offset = (filters.page - 1) * filters.limit;
		let query = supabase
			.from('pl_parameter')
			.select('*', { count: 'exact' })
			.order('createdAt', { ascending: false })
			.range(offset, offset + filters.limit - 1);

		if (createdBy) {
			query = query.eq('createdBy', createdBy);
		}

		query = this.applyFilters(query, filters);

		const { data, error, count } = await query;
		if (error) throw new Error(error.message);
		return { data: data ?? [], total: count ?? 0 };
	}

	// Retorna TODOS os públicos que casam com os filtros (cap 500). A
	// ordenação (salvos/likes/rating) e a paginação são feitas no service,
	// depois do enrichment — senão a ordem só valeria dentro da página.
	async listCommunity(filters: CommunityListQuery) {
		let query = supabase
			.from('pl_parameter')
			.select('*', { count: 'exact' })
			.eq('isPublic', true)
			.order('createdAt', { ascending: false })
			.limit(500);

		query = this.applyFilters(query, filters);

		const { data, error, count } = await query;
		if (error) throw new Error(error.message);
		return { data: data ?? [], total: count ?? 0 };
	}

	async findById(id: string) {
		const { data, error } = await supabase
			.from('pl_parameter')
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return data;
	}

	async create(
		data: CreateParameter,
		createdBy: string,
		createdByName: string | null,
	) {
		const { data: row, error } = await supabase
			.from('pl_parameter')
			.insert({
				machine: data.machine,
				powerWatts: data.powerWatts,
				lens: data.lens,
				software: data.software,
				material: data.material,
				mode: data.mode,
				speed: data.speed,
				power: data.power,
				frequency: data.frequency,
				line: data.line,
				crossHatch: data.crossHatch ?? false,
				angle: data.angle,
				passes: data.passes ?? 1,
				passesFill: data.passesFill ?? 1,
				defocus: data.defocus ?? null,
				gas: data.gas ?? false,
				notes: data.notes ?? null,
				materialType: data.materialType ?? null,
				thickness: data.thickness ?? null,
				// Campos software-specific
				tamanhoLinha: data.tamanhoLinha ?? null,
				tamanhoDivisao: data.tamanhoDivisao ?? null,
				sobreposicao: data.sobreposicao ?? null,
				forcarSeparacao: data.forcarSeparacao ?? null,
				axisRotative: data.axisRotative ?? null,
				lineTypeId: data.lineTypeId ?? null,
				isPublic: data.isPublic ?? false,
				createdBy,
				createdByName,
			})
			.select()
			.single();
		if (error) throw new Error(error.message);
		return row;
	}

	async update(id: string, data: UpdateParameter) {
		const { data: row, error } = await supabase
			.from('pl_parameter')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return row;
	}

	async delete(id: string) {
		const { error } = await supabase.from('pl_parameter').delete().eq('id', id);
		if (error) throw new Error(error.message);
	}

	async stats() {
		const [params, machines, materials] = await Promise.all([
			supabase
				.from('pl_parameter')
				.select('createdBy', { count: 'exact', head: false }),
			supabase
				.from('pl_parameter_machine')
				.select('id', { count: 'exact', head: true }),
			supabase
				.from('pl_parameter_material')
				.select('id', { count: 'exact', head: true }),
		]);

		if (params.error) throw new Error(params.error.message);
		const contributors = new Set(
			(params.data ?? []).map((p: { createdBy: string }) => p.createdBy),
		);

		return {
			totalParameters: params.count ?? 0,
			totalMachines: machines.count ?? 0,
			totalMaterials: materials.count ?? 0,
			totalContributors: contributors.size,
		};
	}

	async listMachines() {
		const { data, error } = await supabase
			.from('pl_parameter_machine')
			.select('*')
			.order('brand', { ascending: true });
		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async listMaterials() {
		const { data, error } = await supabase
			.from('pl_parameter_material')
			.select('*')
			.order('name', { ascending: true });
		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async toggleSave(parameterId: string, customerId: string, save: boolean) {
		if (save) {
			const { error } = await supabase
				.from('pl_parameter_save')
				.upsert({ parameterId, customerId });
			if (error) throw new Error(error.message);
		} else {
			const { error } = await supabase
				.from('pl_parameter_save')
				.delete()
				.eq('parameterId', parameterId)
				.eq('customerId', customerId);
			if (error) throw new Error(error.message);
		}
	}

	async toggleLike(parameterId: string, customerId: string) {
		const { data: existing } = await supabase
			.from('pl_parameter_like')
			.select('parameterId')
			.eq('parameterId', parameterId)
			.eq('customerId', customerId)
			.maybeSingle();

		if (existing) {
			const { error } = await supabase
				.from('pl_parameter_like')
				.delete()
				.eq('parameterId', parameterId)
				.eq('customerId', customerId);
			if (error) throw new Error(error.message);
			return { liked: false };
		}

		const { error } = await supabase
			.from('pl_parameter_like')
			.insert({ parameterId, customerId });
		if (error) throw new Error(error.message);
		return { liked: true };
	}

	async rate(parameterId: string, customerId: string, rating: number) {
		const { error } = await supabase
			.from('pl_parameter_rating')
			.upsert({ parameterId, customerId, rating });
		if (error) throw new Error(error.message);
	}

	async getInteractionCounts(parameterIds: string[]) {
		if (parameterIds.length === 0) return new Map();

		const [likes, ratings, saves] = await Promise.all([
			supabase
				.from('pl_parameter_like')
				.select('parameterId')
				.in('parameterId', parameterIds),
			supabase
				.from('pl_parameter_rating')
				.select('parameterId, rating')
				.in('parameterId', parameterIds),
			supabase
				.from('pl_parameter_save')
				.select('parameterId')
				.in('parameterId', parameterIds),
		]);

		const map = new Map<
			string,
			{ likesCount: number; rating: number | null; savesCount: number }
		>();
		for (const id of parameterIds) {
			map.set(id, { likesCount: 0, rating: null, savesCount: 0 });
		}

		for (const l of likes.data ?? []) {
			const entry = map.get(l.parameterId);
			if (entry) entry.likesCount++;
		}
		for (const s of saves.data ?? []) {
			const entry = map.get(s.parameterId);
			if (entry) entry.savesCount++;
		}
		const ratingsByParam = new Map<string, number[]>();
		for (const r of ratings.data ?? []) {
			const arr = ratingsByParam.get(r.parameterId) ?? [];
			arr.push(r.rating);
			ratingsByParam.set(r.parameterId, arr);
		}
		for (const [id, arr] of ratingsByParam) {
			const entry = map.get(id);
			if (entry && arr.length > 0) {
				entry.rating = arr.reduce((a, b) => a + b, 0) / arr.length;
			}
		}

		return map;
	}

	async getUserInteractions(parameterIds: string[], customerId: string) {
		if (parameterIds.length === 0) {
			return new Map<
				string,
				{ isSaved: boolean; isLiked: boolean; userRating: number | null }
			>();
		}

		const [saves, likes, ratings] = await Promise.all([
			supabase
				.from('pl_parameter_save')
				.select('parameterId')
				.eq('customerId', customerId)
				.in('parameterId', parameterIds),
			supabase
				.from('pl_parameter_like')
				.select('parameterId')
				.eq('customerId', customerId)
				.in('parameterId', parameterIds),
			supabase
				.from('pl_parameter_rating')
				.select('parameterId, rating')
				.eq('customerId', customerId)
				.in('parameterId', parameterIds),
		]);

		const map = new Map<
			string,
			{ isSaved: boolean; isLiked: boolean; userRating: number | null }
		>();
		for (const id of parameterIds) {
			map.set(id, { isSaved: false, isLiked: false, userRating: null });
		}
		for (const s of saves.data ?? []) {
			const e = map.get(s.parameterId);
			if (e) e.isSaved = true;
		}
		for (const l of likes.data ?? []) {
			const e = map.get(l.parameterId);
			if (e) e.isLiked = true;
		}
		for (const r of ratings.data ?? []) {
			const e = map.get(r.parameterId);
			if (e) e.userRating = r.rating;
		}
		return map;
	}
}

export const parameterRepository = new ParameterRepository();
