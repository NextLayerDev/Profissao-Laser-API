import { supabase } from '../lib/supabase.js';
import type {
	CreateToolBankEntry,
	ToolBankEntry,
	UpdateToolBankEntry,
} from '../types/tool-bank.js';

const TABLE = 'pl_tool_bank_entry';

class ToolBankRepository {
	async list(
		toolKey: string,
		opts: { activeOnly: boolean; category?: string },
	): Promise<ToolBankEntry[]> {
		let q = supabase.from(TABLE).select('*').eq('tool_key', toolKey);
		if (opts.activeOnly) q = q.eq('active', true);
		if (opts.category) q = q.eq('category', opts.category);
		const { data, error } = await q
			.order('position', { ascending: true })
			.order('created_at', { ascending: true });
		if (error) throw new Error(error.message);
		return (data ?? []) as ToolBankEntry[];
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
