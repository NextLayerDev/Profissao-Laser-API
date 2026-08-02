import { supabase } from '../lib/supabase.js';
import type {
	CollectionConfig,
	CollectionFieldSpec,
} from '../lib/tool-collections.js';

/**
 * Repositório das COLEÇÕES. Uma única implementação serve qualquer dataset de
 * qualquer tool: tudo que varia (campos, facetas, ordenação, busca) vem da
 * `definition`, não daqui.
 *
 * Mora sobre `pl_tool_bank_entry` — a mesma tabela do "Banco do Admin", agora
 * com `collection`, moderação, dono e score (ver `sql/tool-collections.sql`).
 */

const TABLE = 'pl_tool_bank_entry';
const FEEDBACK_TABLE = 'pl_tool_entry_feedback';

/** Teto por página. Sem isto, um cliente pede `limit=99999` e derruba a API. */
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 24;

export interface CollectionEntry {
	id: string;
	tool_key: string;
	collection: string;
	title: string;
	description: string | null;
	category: string | null;
	position: number;
	active: boolean;
	status: 'draft' | 'pending' | 'approved' | 'rejected';
	review_note: string | null;
	owner_id: string | null;
	visibility: 'public' | 'owner' | 'staff';
	score: number | null;
	stats: Record<string, number>;
	data: Record<string, unknown>;
	example_before_url: string | null;
	example_after_url: string | null;
	created_at: string;
	updated_at: string;
}

/** Filtro de faceta: valor exato (enum) ou faixa numérica. */
export type FacetFilter =
	// `boolean` é tão importante quanto os outros dois: em jsonb, `true` e
	// `"true"` não são o mesmo valor, e a contenção só casa com o tipo certo.
	| { kind: 'eq'; value: string | number | boolean }
	| { kind: 'range'; min?: number; max?: number };

export interface ListCollectionOpts {
	/** Filtros por campo de `data`, vindos das facetas da tela. */
	filters?: Record<string, FacetFilter>;
	/** Busca textual sobre os campos declarados em `collection.search`. */
	q?: string;
	sort?: string;
	page?: number;
	pageSize?: number;
	/** Quem está lendo — decide o que aparece (moderação e visibilidade). */
	viewer: { customerId: string; isStaff: boolean };
	/** Só os registros submetidos por este cliente ("minhas submissões"). */
	mineOnly?: boolean;
}

export interface ListCollectionResult {
	items: CollectionEntry[];
	total: number;
	page: number;
	pageSize: number;
	pages: number;
}

/**
 * Só os métodos do builder do supabase-js que usamos. Tipar estruturalmente
 * evita o `Type instantiation is excessively deep` que os tipos gerados do
 * PostgREST provocam quando um query builder é passado adiante.
 */
interface FacetQuery<Self> {
	contains(column: string, value: Record<string, unknown>): Self;
	gte(column: string, value: unknown): Self;
	lte(column: string, value: unknown): Self;
}

/**
 * Aplica um filtro de faceta sobre um campo de `data`.
 *
 * ARMADILHA CENTRAL: faixa numérica usa `data->campo` (jsonb), NUNCA
 * `data->>campo` (texto). Verificado no banco: em jsonb, números comparam
 * numericamente (`9 >= 10` = falso); como texto, comparam alfabeticamente
 * (`'9' >= '10'` = VERDADEIRO). Com `->>`, "espessura de 10mm pra cima"
 * devolveria as receitas de 9mm — erro silencioso e caríssimo.
 */
function applyFacetFilter<T extends FacetQuery<T>>(
	q: T,
	field: string,
	f: FacetFilter,
): T {
	if (f.kind === 'eq') {
		// `@>` de contenção — é o operador que o índice GIN composto atende.
		return q.contains('data', { [field]: f.value });
	}
	let out = q;
	if (typeof f.min === 'number') out = out.gte(`data->${field}`, f.min);
	if (typeof f.max === 'number') out = out.lte(`data->${field}`, f.max);
	return out;
}

/** Colunas de ordenação permitidas. Whitelist — o valor vem do cliente. */
const SORT_COLUMNS: Record<string, { column: string; ascending: boolean }> = {
	score: { column: 'score', ascending: false },
	recent: { column: 'created_at', ascending: false },
	oldest: { column: 'created_at', ascending: true },
	title: { column: 'title', ascending: true },
	position: { column: 'position', ascending: true },
};

class ToolCollectionRepository {
	/** Base comum: escopo da coleção + regras de moderação e visibilidade. */
	private scoped(
		toolKey: string,
		collection: string,
		viewer: ListCollectionOpts['viewer'],
		select = '*',
		count?: 'exact',
	) {
		let q = supabase
			.from(TABLE)
			.select(select, count ? { count } : undefined)
			.eq('tool_key', toolKey)
			.eq('collection', collection);

		if (!viewer.isStaff) {
			// O aluno vê o que está aprovado e ativo, MAIS as próprias submissões
			// (inclusive pendentes — senão ele submete e a linha "some").
			q = q
				.or(
					`and(status.eq.approved,active.is.true,visibility.eq.public),owner_id.eq.${viewer.customerId}`,
				)
				// `visibility:'staff'` nunca vaza, nem para o próprio dono.
				.neq('visibility', 'staff');
		}
		return q;
	}

	async list(
		toolKey: string,
		collection: string,
		config: CollectionConfig,
		opts: ListCollectionOpts,
	): Promise<ListCollectionResult> {
		const pageSize = Math.min(
			Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE),
			MAX_PAGE_SIZE,
		);
		const page = Math.max(1, opts.page ?? 1);
		const from = (page - 1) * pageSize;

		let q = this.scoped(toolKey, collection, opts.viewer, '*', 'exact');

		if (opts.mineOnly) q = q.eq('owner_id', opts.viewer.customerId);

		for (const [field, filter] of Object.entries(opts.filters ?? {})) {
			q = applyFacetFilter(q, field, filter);
		}

		if (opts.q?.trim()) {
			const term = opts.q.trim().replace(/[%,()]/g, ' ');
			// `collection.search` decide onde buscar; sem ele, título e descrição.
			const targets = config.search?.length
				? config.search
				: ['title', 'description'];
			const ors = targets.map((t) =>
				t.startsWith('data.')
					? `data->>${t.slice('data.'.length)}.ilike.%${term}%`
					: `${t}.ilike.%${term}%`,
			);
			q = q.or(ors.join(','));
		}

		const sort = SORT_COLUMNS[opts.sort ?? ''] ?? SORT_COLUMNS.position;
		q = q
			.order(sort.column, { ascending: sort.ascending, nullsFirst: false })
			// Desempate estável: sem isto, duas páginas podem repetir ou pular uma
			// linha quando várias têm o mesmo score.
			.order('id', { ascending: true })
			.range(from, from + pageSize - 1);

		const { data, error, count } = await q;
		if (error) throw new Error(error.message);

		const total = count ?? 0;
		return {
			items: (data ?? []) as unknown as CollectionEntry[],
			total,
			page,
			pageSize,
			pages: Math.max(1, Math.ceil(total / pageSize)),
		};
	}

	/**
	 * Contagem por opção de faceta ("aço carbono (142)").
	 *
	 * Busca só a coluna `data` das linhas visíveis e agrega em memória. É o
	 * caminho honesto com PostgREST, que não expõe `GROUP BY`; a alternativa
	 * seria um RPC por coleção, que quebraria a promessa de "coleção nova = zero
	 * DDL". Teto de linhas para o custo ser previsível.
	 */
	async facetCounts(
		toolKey: string,
		collection: string,
		config: CollectionConfig,
		opts: Pick<ListCollectionOpts, 'viewer' | 'filters' | 'q'>,
		cap = 5000,
	): Promise<Record<string, Record<string, number>>> {
		const faceted = config.fields.filter((f) => f.facet && f.facet !== 'range');
		if (!faceted.length) return {};

		let q = this.scoped(toolKey, collection, opts.viewer, 'data');
		// Uma faceta NÃO se filtra a si mesma: senão, ao escolher "aço carbono" as
		// outras opções de material zerariam e o usuário ficaria preso na escolha.
		for (const [field, filter] of Object.entries(opts.filters ?? {})) {
			if (faceted.some((f) => f.name === field)) continue;
			q = applyFacetFilter(q, field, filter);
		}

		const { data, error } = await q.limit(cap);
		if (error) throw new Error(error.message);

		const out: Record<string, Record<string, number>> = {};
		for (const f of faceted) out[f.name] = {};
		const rows = (data ?? []) as unknown as {
			data: Record<string, unknown>;
		}[];
		for (const row of rows) {
			for (const f of faceted) {
				const v = row.data?.[f.name];
				if (v === undefined || v === null) continue;
				const key = String(v);
				out[f.name][key] = (out[f.name][key] ?? 0) + 1;
			}
		}
		return out;
	}

	async findById(
		id: string,
		toolKey: string,
		collection: string,
	): Promise<CollectionEntry | null> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('*')
			.eq('id', id)
			.eq('tool_key', toolKey)
			.eq('collection', collection)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as CollectionEntry) ?? null;
	}

	async create(input: {
		toolKey: string;
		collection: string;
		title: string;
		description?: string | null;
		category?: string | null;
		data: Record<string, unknown>;
		status: CollectionEntry['status'];
		ownerId: string | null;
		visibility?: CollectionEntry['visibility'];
		exampleBeforeUrl?: string | null;
		exampleAfterUrl?: string | null;
		createdBy?: string | null;
	}): Promise<CollectionEntry> {
		const { data, error } = await supabase
			.from(TABLE)
			.insert({
				tool_key: input.toolKey,
				collection: input.collection,
				title: input.title,
				description: input.description ?? null,
				category: input.category ?? null,
				data: input.data,
				status: input.status,
				owner_id: input.ownerId,
				visibility: input.visibility ?? 'public',
				active: true,
				position: 0,
				example_before_url: input.exampleBeforeUrl ?? null,
				example_after_url: input.exampleAfterUrl ?? null,
				created_by: input.createdBy ?? null,
			})
			.select()
			.single();
		if (error) throw new Error(error.message);
		return data as CollectionEntry;
	}

	/** Insere em lote (import CSV/JSON). Devolve quantas linhas entraram. */
	async createMany(
		rows: Parameters<ToolCollectionRepository['create']>[0][],
	): Promise<number> {
		if (!rows.length) return 0;
		const payload = rows.map((r) => ({
			tool_key: r.toolKey,
			collection: r.collection,
			title: r.title,
			description: r.description ?? null,
			category: r.category ?? null,
			data: r.data,
			status: r.status,
			owner_id: r.ownerId,
			visibility: r.visibility ?? 'public',
			active: true,
			position: 0,
			created_by: r.createdBy ?? null,
		}));
		const { data, error } = await supabase
			.from(TABLE)
			.insert(payload)
			.select('id');
		if (error) throw new Error(error.message);
		return (data ?? []).length;
	}

	async update(
		id: string,
		toolKey: string,
		collection: string,
		patch: Partial<{
			title: string;
			description: string | null;
			category: string | null;
			data: Record<string, unknown>;
			active: boolean;
			position: number;
			status: CollectionEntry['status'];
			review_note: string | null;
			reviewed_by: string | null;
			reviewed_at: string | null;
			visibility: CollectionEntry['visibility'];
			example_before_url: string | null;
			example_after_url: string | null;
		}>,
	): Promise<CollectionEntry> {
		const { data, error } = await supabase
			.from(TABLE)
			.update({ ...patch, updated_at: new Date().toISOString() })
			.eq('id', id)
			.eq('tool_key', toolKey)
			.eq('collection', collection)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return data as CollectionEntry;
	}

	async remove(id: string, toolKey: string, collection: string): Promise<void> {
		const { error } = await supabase
			.from(TABLE)
			.delete()
			.eq('id', id)
			.eq('tool_key', toolKey)
			.eq('collection', collection);
		if (error) throw new Error(error.message);
	}

	/**
	 * "Receita mais próxima": quando não existe o registro exato, acha o mais
	 * perto pelos campos numéricos declarados em `collection.nearest.on`, dentro
	 * do mesmo grupo (`groupBy` — ex.: mesmo material e mesma operação).
	 *
	 * A distância é normalizada pelo alcance de cada eixo: sem normalizar,
	 * potência (500..6000 W) esmagaria espessura (1..20 mm) e o "mais próximo"
	 * seria sempre o de potência parecida, ignorando a espessura — que é o eixo
	 * que mais muda a receita.
	 *
	 * SÓ CONSIDERA REGISTRO APROVADO — inclusive para staff, e de propósito.
	 * `nearest` é RECOMENDAÇÃO, não navegação: devolver uma submissão ainda
	 * pendente como "a receita mais próxima" é apresentar dado não validado
	 * como se fosse validado, que é o pior modo de falha desta ferramenta
	 * (alguém corta chapa com ele). Para ver pendentes, use `list`.
	 */
	async nearest(
		toolKey: string,
		collection: string,
		config: CollectionConfig,
		target: Record<string, number>,
		group: Record<string, string | number> = {},
		cap = 2000,
	): Promise<{ entry: CollectionEntry; distance: number }[]> {
		const axes = (config.nearest?.on ?? []).map((a) =>
			a.startsWith('data.') ? a.slice('data.'.length) : a,
		);
		if (!axes.length) return [];

		let q = supabase
			.from(TABLE)
			.select('*')
			.eq('tool_key', toolKey)
			.eq('collection', collection)
			.eq('status', 'approved')
			.eq('active', true)
			.eq('visibility', 'public');
		for (const [k, v] of Object.entries(group)) {
			q = q.contains('data', { [k]: v });
		}
		const { data, error } = await q.limit(cap);
		if (error) throw new Error(error.message);

		const rows = (data ?? []) as unknown as CollectionEntry[];
		if (!rows.length) return [];

		// Alcance real de cada eixo no conjunto candidato, para normalizar.
		const range: Record<string, number> = {};
		for (const axis of axes) {
			const vals = rows
				.map((r) => Number(r.data?.[axis]))
				.filter((n) => Number.isFinite(n));
			const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
			range[axis] = spread > 0 ? spread : 1;
		}

		return rows
			.map((entry) => {
				let sum = 0;
				let used = 0;
				for (const axis of axes) {
					const want = target[axis];
					const got = Number(entry.data?.[axis]);
					if (!Number.isFinite(want) || !Number.isFinite(got)) continue;
					sum += ((want - got) / range[axis]) ** 2;
					used++;
				}
				return {
					entry,
					distance: used ? Math.sqrt(sum / used) : Number.POSITIVE_INFINITY,
				};
			})
			.filter((r) => Number.isFinite(r.distance))
			.sort(
				(a, b) =>
					a.distance - b.distance ||
					// Empate técnico: prefere o de maior confiança.
					(b.entry.score ?? 0) - (a.entry.score ?? 0),
			);
	}

	/* ───────────────────────── feedback ───────────────────────── */

	/**
	 * Upsert de like/save/rating/result. O `score` e o `stats` do registro são
	 * recalculados por TRIGGER no banco (`pl_tool_entry_feedback_trg`), não aqui
	 * — assim a confiança fica correta mesmo se alguém escrever direto no SQL.
	 */
	async upsertFeedback(input: {
		entryId: string;
		customerId: string;
		kind: 'like' | 'save' | 'rating' | 'result';
		value?: number | null;
		outcome?: string | null;
		payload?: Record<string, unknown>;
		note?: string | null;
	}): Promise<void> {
		const { error } = await supabase.from(FEEDBACK_TABLE).upsert(
			{
				entry_id: input.entryId,
				customer_id: input.customerId,
				kind: input.kind,
				value: input.value ?? null,
				outcome: input.outcome ?? null,
				payload: input.payload ?? {},
				note: input.note ?? null,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: 'entry_id,customer_id,kind' },
		);
		if (error) throw new Error(error.message);
	}

	async removeFeedback(
		entryId: string,
		customerId: string,
		kind: string,
	): Promise<void> {
		const { error } = await supabase
			.from(FEEDBACK_TABLE)
			.delete()
			.eq('entry_id', entryId)
			.eq('customer_id', customerId)
			.eq('kind', kind);
		if (error) throw new Error(error.message);
	}

	/** O que ESTE cliente já marcou nos registros da página (para a UI). */
	async myFeedback(
		entryIds: string[],
		customerId: string,
	): Promise<
		Record<
			string,
			Record<string, { value: number | null; outcome: string | null }>
		>
	> {
		if (!entryIds.length) return {};
		const { data, error } = await supabase
			.from(FEEDBACK_TABLE)
			.select('entry_id, kind, value, outcome')
			.eq('customer_id', customerId)
			.in('entry_id', entryIds);
		if (error) throw new Error(error.message);

		const out: Record<
			string,
			Record<string, { value: number | null; outcome: string | null }>
		> = {};
		for (const r of (data ?? []) as {
			entry_id: string;
			kind: string;
			value: number | null;
			outcome: string | null;
		}[]) {
			out[r.entry_id] ??= {};
			out[r.entry_id][r.kind] = { value: r.value, outcome: r.outcome };
		}
		return out;
	}

	/** Registros de uma coleção para o RAG (só aprovados e públicos). */
	async listForRag(
		toolKey: string,
		collection: string,
		limit = 1000,
		offset = 0,
	): Promise<CollectionEntry[]> {
		const { data, error } = await supabase
			.from(TABLE)
			.select('*')
			.eq('tool_key', toolKey)
			.eq('collection', collection)
			.eq('status', 'approved')
			.eq('active', true)
			.eq('visibility', 'public')
			.order('updated_at', { ascending: false })
			.range(offset, offset + limit - 1);
		if (error) throw new Error(error.message);
		return (data ?? []) as CollectionEntry[];
	}
}

export const toolCollectionRepository = new ToolCollectionRepository();

/** Campos com faceta de faixa, para a tela desenhar os limites do slider. */
export function rangeFields(config: CollectionConfig): CollectionFieldSpec[] {
	return config.fields.filter((f) => f.facet === 'range');
}
