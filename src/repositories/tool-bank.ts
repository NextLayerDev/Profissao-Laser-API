import { supabase } from '../lib/supabase.js';
import type {
	CreateToolBankEntry,
	ToolBankEntry,
	UpdateToolBankEntry,
} from '../types/tool-bank.js';

const TABLE = 'pl_tool_bank_entry';

/**
 * Tamanho de página ao varrer o banco inteiro. O PostgREST tem um teto de linhas
 * por resposta (1000 por padrão no Supabase) e o aplica EM SILÊNCIO: sem
 * `.range()`, uma tool com 1200 registros devolvia 1000 e ninguém percebia.
 * Varremos em páginas para que o chamador receba tudo.
 */
const PAGE = 1000;
/**
 * Trava de segurança da varredura (1000 páginas = 1M registros). Existe para
 * um bug de paginação não virar loop infinito segurando o event loop.
 */
const MAX_PAGES = 1000;

export interface ListToolBankOpts {
	activeOnly: boolean;
	category?: string;
	/** Página única com este tamanho. Ausente = varre tudo. */
	limit?: number;
	offset?: number;
}

class ToolBankRepository {
	/**
	 * Lista os registros do banco de uma tool.
	 *
	 * Sem `limit`, varre TODAS as páginas — o comportamento que os chamadores
	 * antigos já assumiam mas não tinham. Com `limit`, devolve uma página só.
	 */
	async list(
		toolKey: string,
		opts: ListToolBankOpts,
	): Promise<ToolBankEntry[]> {
		const baseQuery = () => {
			let q = supabase.from(TABLE).select('*').eq('tool_key', toolKey);
			if (opts.activeOnly) q = q.eq('active', true);
			if (opts.category) q = q.eq('category', opts.category);
			return q
				.order('position', { ascending: true })
				.order('created_at', { ascending: true });
		};

		if (typeof opts.limit === 'number') {
			const from = opts.offset ?? 0;
			const { data, error } = await baseQuery().range(
				from,
				from + opts.limit - 1,
			);
			if (error) throw new Error(error.message);
			return (data ?? []) as ToolBankEntry[];
		}

		const all: ToolBankEntry[] = [];
		for (let page = 0; page < MAX_PAGES; page++) {
			const from = page * PAGE;
			const { data, error } = await baseQuery().range(from, from + PAGE - 1);
			if (error) throw new Error(error.message);
			const rows = (data ?? []) as ToolBankEntry[];
			all.push(...rows);
			if (rows.length < PAGE) return all;
		}
		console.warn(
			`[tool-bank] varredura de '${toolKey}' atingiu ${MAX_PAGES} páginas; resultado pode estar truncado.`,
		);
		return all;
	}

	/** Total de registros que casam com o filtro (para paginação na UI). */
	async count(
		toolKey: string,
		opts: { activeOnly: boolean; category?: string },
	): Promise<number> {
		let q = supabase
			.from(TABLE)
			.select('id', { count: 'exact', head: true })
			.eq('tool_key', toolKey);
		if (opts.activeOnly) q = q.eq('active', true);
		if (opts.category) q = q.eq('category', opts.category);
		const { count, error } = await q;
		if (error) throw new Error(error.message);
		return count ?? 0;
	}

	async findById(
		id: string,
		toolKey: string,
		opts: { activeOnly?: boolean } = {},
	): Promise<ToolBankEntry | null> {
		let q = supabase
			.from(TABLE)
			.select('*')
			.eq('id', id)
			.eq('tool_key', toolKey);
		if (opts.activeOnly) q = q.eq('active', true);
		const { data, error } = await q.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as ToolBankEntry) ?? null;
	}

	async create(
		toolKey: string,
		data: CreateToolBankEntry,
		createdBy: string | null,
	): Promise<ToolBankEntry> {
		const { data: row, error } = await supabase
			.from(TABLE)
			.insert({
				tool_key: toolKey,
				title: data.title,
				description: data.description ?? null,
				category: data.category ?? null,
				position: data.position ?? 0,
				active: data.active ?? true,
				data: data.data ?? {},
				example_before_url: data.example_before_url ?? null,
				example_after_url: data.example_after_url ?? null,
				created_by: createdBy,
			})
			.select()
			.single();
		if (error) throw new Error(error.message);
		return row as ToolBankEntry;
	}

	async update(
		id: string,
		toolKey: string,
		data: UpdateToolBankEntry,
	): Promise<ToolBankEntry> {
		const payload: Record<string, unknown> = {
			updated_at: new Date().toISOString(),
		};
		if (data.title !== undefined) payload.title = data.title;
		if (data.description !== undefined) payload.description = data.description;
		if (data.category !== undefined) payload.category = data.category;
		if (data.position !== undefined) payload.position = data.position;
		if (data.active !== undefined) payload.active = data.active;
		if (data.data !== undefined) payload.data = data.data;
		if (data.example_before_url !== undefined) {
			payload.example_before_url = data.example_before_url;
		}
		if (data.example_after_url !== undefined) {
			payload.example_after_url = data.example_after_url;
		}
		const { data: row, error } = await supabase
			.from(TABLE)
			.update(payload)
			.eq('id', id)
			.eq('tool_key', toolKey)
			.select()
			.single();
		if (error) throw new Error(error.message);
		return row as ToolBankEntry;
	}

	async remove(id: string, toolKey: string): Promise<void> {
		const { error } = await supabase
			.from(TABLE)
			.delete()
			.eq('id', id)
			.eq('tool_key', toolKey);
		if (error) throw new Error(error.message);
	}

	async reorder(toolKey: string, ids: string[]): Promise<void> {
		await Promise.all(
			ids.map((id, index) =>
				supabase
					.from(TABLE)
					.update({ position: index, updated_at: new Date().toISOString() })
					.eq('id', id)
					.eq('tool_key', toolKey),
			),
		);
	}
}

export const toolBankRepository = new ToolBankRepository();
