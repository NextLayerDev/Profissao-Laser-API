import { supabase } from '../lib/supabase.js';
import type {
	CommunityListQuery,
	CreateParameter,
	ListParametersQuery,
	ParameterSidebar,
	PassRecipe,
	UpdateParameter,
	UpdateParameterOption,
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
		if (filters.software) q = q.eq('software', filters.software) as T;
		if (filters.category) q = q.eq('category', filters.category) as T;
		if (filters.lens) q = q.eq('lens', filters.lens) as T;
		if (filters.color) q = q.eq('color', filters.color) as T;
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
			.is('parentId', null) // não lista passadas-filhas, só pais/avulsos
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
			.eq('status', 'approved') // só aprovados (envios pendentes/rejeitados ficam fora)
			.is('parentId', null) // não lista passadas-filhas, só pais/avulsos
			.order('createdAt', { ascending: false })
			.limit(500);

		query = this.applyFilters(query, filters);

		const { data, error, count } = await query;
		if (error) throw new Error(error.message);
		return { data: data ?? [], total: count ?? 0 };
	}

	/** Fila de revisão: envios de membros aguardando aprovação (mais antigos 1º). */
	async listPending(filters: ListParametersQuery) {
		const offset = (filters.page - 1) * filters.limit;
		let query = supabase
			.from('pl_parameter')
			.select('*', { count: 'exact' })
			.eq('status', 'pending')
			.is('parentId', null) // só pais/avulsos, não passadas-filhas
			.order('createdAt', { ascending: true })
			.range(offset, offset + filters.limit - 1);

		query = this.applyFilters(query, filters);

		const { data, error, count } = await query;
		if (error) throw new Error(error.message);
		return { data: data ?? [], total: count ?? 0 };
	}

	/** Envios do próprio membro (qualquer status), mais recentes primeiro. */
	async listMySubmissions(userId: string) {
		const { data, error } = await supabase
			.from('pl_parameter')
			.select('*')
			.eq('submittedBy', userId)
			.is('parentId', null) // só pais/avulsos, não passadas-filhas
			.order('createdAt', { ascending: false });
		if (error) throw new Error(error.message);
		return data ?? [];
	}

	/**
	 * Revisa um envio: aprovar publica (isPublic=true, status=approved), rejeitar
	 * fecha (isPublic=false, status=rejected). O mesmo status/visibilidade desce
	 * pras passadas-filhas (que não guardam reviewNote). Retorna o pai atualizado.
	 */
	async review(
		id: string,
		action: 'approve' | 'reject',
		reviewNote: string | null,
		reviewerId: string,
	) {
		const approved = action === 'approve';
		const now = new Date().toISOString();
		const patch = {
			status: approved ? 'approved' : 'rejected',
			isPublic: approved,
			reviewedBy: reviewerId,
			reviewedAt: now,
			reviewNote: reviewNote ?? null,
			updatedAt: now,
		};
		const { error } = await supabase
			.from('pl_parameter')
			.update(patch)
			.eq('id', id);
		if (error) throw new Error(error.message);

		// Passadas-filhas seguem o status/visibilidade do pai (sem reviewNote).
		const { error: childErr } = await supabase
			.from('pl_parameter')
			.update({
				status: patch.status,
				isPublic: patch.isPublic,
				reviewedAt: now,
				updatedAt: now,
			})
			.eq('parentId', id);
		if (childErr) throw new Error(childErr.message);

		return this.findById(id);
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

	/** Parâmetro + suas passadas em ordem (pai = passada 1, depois os filhos). */
	async getWithPasses(id: string) {
		const parent = await this.findById(id);
		if (!parent) return null;
		if (!parent.isParent) return { ...parent, passes: [parent] };
		const { data: children, error } = await supabase
			.from('pl_parameter')
			.select('*')
			.eq('parentId', id)
			.order('passOrder', { ascending: true });
		if (error) throw new Error(error.message);
		return { ...parent, passes: [parent, ...(children ?? [])] };
	}

	/** Mapeia os campos de recipe de uma passada p/ uma linha de pl_parameter. */
	private recipeRow(data: CreateParameter | PassRecipe) {
		return {
			machine: data.machine,
			powerWatts: data.powerWatts,
			lens: data.lens,
			software: data.software,
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
			qPulse: data.qPulse ?? null,
			notes: data.notes ?? null,
			tamanhoLinha: data.tamanhoLinha ?? null,
			tamanhoDivisao: data.tamanhoDivisao ?? null,
			sobreposicao: data.sobreposicao ?? null,
			forcarSeparacao: data.forcarSeparacao ?? null,
			axisRotative: data.axisRotative ?? null,
			lineTypeId: data.lineTypeId ?? null,
		};
	}

	async create(
		data: CreateParameter,
		createdBy: string,
		createdByName: string | null,
		opts?: { asSubmission?: boolean },
	) {
		const hasPasses = (data.extraPasses?.length ?? 0) > 0;
		// Envio de membro: entra como pending (vai pra fila de revisão) e NUNCA
		// público até ser aprovado. Criação admin (padrão): approved.
		const status = opts?.asSubmission ? 'pending' : 'approved';
		const isPublic = opts?.asSubmission ? false : (data.isPublic ?? false);
		// Linha "pai" (= passada 1) com os metadados (material/imagem/categoria).
		const { data: parent, error } = await supabase
			.from('pl_parameter')
			.insert({
				...this.recipeRow(data),
				material: data.material,
				materialType: data.materialType ?? null,
				thickness: data.thickness ?? null,
				imageUrl: data.imageUrl ?? null,
				category: data.category ?? null,
				color: data.color ?? null,
				isPublic,
				status,
				submittedBy: opts?.asSubmission ? createdBy : null,
				isParent: hasPasses,
				parentId: null,
				passOrder: hasPasses ? 1 : null,
				createdBy,
				createdByName,
			})
			.select()
			.single();
		if (error) throw new Error(error.message);

		// Passadas extras (2..N): linhas-filhas com recipe próprio, herdando o
		// material/status do pai. A passada 1 é o próprio pai. Filhas nunca são
		// públicas por si só (a visibilidade é do pai), e herdam o status pra não
		// ficarem 'approved' soltas quando o pai está pending.
		if (hasPasses && data.extraPasses) {
			const children = data.extraPasses.map((p, i) => ({
				...this.recipeRow(p),
				// passadas herdam máquina/lente/software/modo/material do pai
				machine: data.machine,
				powerWatts: data.powerWatts,
				lens: data.lens,
				software: data.software,
				mode: data.mode,
				material: data.material,
				imageUrl: null,
				category: null,
				isPublic: false,
				status,
				isParent: false,
				parentId: parent.id,
				passOrder: i + 2,
				createdBy,
				createdByName,
			}));
			const { error: childErr } = await supabase
				.from('pl_parameter')
				.insert(children);
			if (childErr) {
				// Rollback do pai p/ não deixar parâmetro órfão sem passadas.
				await supabase.from('pl_parameter').delete().eq('id', parent.id);
				throw new Error(childErr.message);
			}
		}
		return parent;
	}

	async update(id: string, data: UpdateParameter) {
		// `extraPasses` nao e coluna: separamos. Quando vier (mesmo []), o
		// parametro vira/deixa de ser pai e reconstruimos as passadas-filhas.
		const { extraPasses, ...rest } = data;
		const patch = {
			...rest,
			updatedAt: new Date().toISOString(),
			...(extraPasses !== undefined
				? {
						isParent: extraPasses.length > 0,
						passOrder: extraPasses.length > 0 ? 1 : null,
					}
				: {}),
		};
		const { data: row, error } = await supabase
			.from('pl_parameter')
			.update(patch)
			.eq('id', id)
			.select()
			.single();
		if (error) throw new Error(error.message);

		if (extraPasses !== undefined) {
			// substitui as passadas: apaga as antigas e recria 2..N
			await supabase.from('pl_parameter').delete().eq('parentId', id);
			if (extraPasses.length > 0) {
				const children = extraPasses.map((p, i) => ({
					...this.recipeRow(p),
					machine: row.machine,
					powerWatts: row.powerWatts,
					lens: row.lens,
					software: row.software,
					mode: row.mode,
					material: row.material,
					imageUrl: null,
					category: null,
					isPublic: row.isPublic ?? false,
					isParent: false,
					parentId: id,
					passOrder: i + 2,
					createdBy: row.createdBy,
					createdByName: row.createdByName,
				}));
				const { error: childErr } = await supabase
					.from('pl_parameter')
					.insert(children);
				if (childErr) throw new Error(childErr.message);
			}
		}
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
				.select('createdBy', { count: 'exact', head: false })
				.is('parentId', null),
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

	/** Sidebar do redesign: top contribuidores, atividade recente, mais usados. */
	async sidebar(): Promise<ParameterSidebar> {
		const [contribRes, recentRes, likeRes] = await Promise.all([
			supabase
				.from('pl_parameter')
				.select('createdBy, createdByName')
				.is('parentId', null),
			supabase
				.from('pl_parameter')
				.select('id, material, createdByName, createdAt')
				.is('parentId', null)
				.order('createdAt', { ascending: false })
				.limit(5),
			supabase.from('pl_parameter_like').select('parameterId'),
		]);
		if (contribRes.error) throw new Error(contribRes.error.message);

		// Top contribuidores por nº de parâmetros.
		const byContrib = new Map<string, { name: string | null; count: number }>();
		for (const p of contribRes.data ?? []) {
			const e = byContrib.get(p.createdBy) ?? {
				name: p.createdByName ?? null,
				count: 0,
			};
			e.count++;
			byContrib.set(p.createdBy, e);
		}
		const topContributors = [...byContrib.entries()]
			.map(([createdBy, v]) => ({ createdBy, name: v.name, count: v.count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5);

		// Mais usados = mais curtidos (top 5).
		const likeCount = new Map<string, number>();
		for (const l of likeRes.data ?? []) {
			likeCount.set(l.parameterId, (likeCount.get(l.parameterId) ?? 0) + 1);
		}
		const topIds = [...likeCount.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([id]) => id);
		let mostUsed: ParameterSidebar['mostUsed'] = [];
		if (topIds.length > 0) {
			const { data: rows } = await supabase
				.from('pl_parameter')
				.select('id, material, imageUrl')
				.in('id', topIds);
			mostUsed = topIds
				.map((id) => {
					const r = (rows ?? []).find((x) => x.id === id);
					return r
						? {
								id,
								material: r.material,
								imageUrl: r.imageUrl ?? null,
								likesCount: likeCount.get(id) ?? 0,
							}
						: null;
				})
				.filter((x): x is NonNullable<typeof x> => x !== null);
		}

		return {
			topContributors,
			recentActivity: (recentRes.data ?? []).map((r) => ({
				id: r.id,
				material: r.material,
				createdByName: r.createdByName ?? null,
				createdAt: r.createdAt,
			})),
			mostUsed,
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

	// ── Vocabulário de opções de filtro (pl_parameter_option) ───────────────

	/** Lista as opções (todas as dimensões ou só uma), por dimensão e ordem. */
	async listOptions(dimension?: string) {
		let query = supabase
			.from('pl_parameter_option')
			.select('*')
			.order('dimension', { ascending: true })
			.order('order', { ascending: true });
		if (dimension) query = query.eq('dimension', dimension);
		const { data, error } = await query;
		if (error) throw new Error(error.message);
		return data ?? [];
	}

	async createOption(dimension: string, value: string, order: number) {
		const { data, error } = await supabase
			.from('pl_parameter_option')
			.insert({ dimension, value, order })
			.select()
			.single();
		if (error) throw new Error(error.message);
		return data;
	}

	async updateOption(id: string, patch: UpdateParameterOption) {
		const { data, error } = await supabase
			.from('pl_parameter_option')
			.update({ ...patch, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return data;
	}

	async deleteOption(id: string) {
		const { error } = await supabase
			.from('pl_parameter_option')
			.delete()
			.eq('id', id);
		if (error) throw new Error(error.message);
	}
}

export const parameterRepository = new ParameterRepository();
