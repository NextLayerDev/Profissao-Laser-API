import { supabase } from '../lib/supabase.js';
import type { OmniKbFile } from '../types/omni.js';

const FILES = 'pl_omni_kb_file';
const CHUNKS = 'pl_omni_kb_chunk';

/** Resultado da busca (RPC pl_omni_match_chunks / pl_omni_keyword_chunks). */
export interface OmniKbMatch {
	chunk_id: number;
	file_id: string;
	content: string;
	similarity?: number;
	rank?: number;
}

/**
 * Base de conhecimento do OmniResposta (RAG): arquivos + chunks com embedding
 * pgvector. A busca vetorial/keyword roda via RPCs criadas no schema
 * (sql/omni-resposta.sql) — o supabase-js não expressa `<=>` diretamente.
 */
class OmniKbRepository {
	async insertFile(row: {
		instance_id: string;
		name: string;
		url: string;
		mime: string;
		size_bytes: number;
	}): Promise<OmniKbFile> {
		const { data, error } = await supabase
			.from(FILES)
			.insert(row)
			.select('*')
			.single();
		if (error) throw new Error(error.message);
		return data as OmniKbFile;
	}

	async listFiles(instanceId: string): Promise<OmniKbFile[]> {
		const { data, error } = await supabase
			.from(FILES)
			.select('*')
			.eq('instance_id', instanceId)
			.order('created_at', { ascending: false });
		if (error) throw new Error(error.message);
		return (data ?? []) as OmniKbFile[];
	}

	async findFileById(id: string): Promise<OmniKbFile | null> {
		const { data, error } = await supabase
			.from(FILES)
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		return (data as OmniKbFile) ?? null;
	}

	async countFiles(instanceId: string): Promise<number> {
		const { count, error } = await supabase
			.from(FILES)
			.select('id', { count: 'exact', head: true })
			.eq('instance_id', instanceId);
		if (error) throw new Error(error.message);
		return count ?? 0;
	}

	async setFileStatus(
		id: string,
		patch: {
			status: 'processing' | 'ready' | 'error';
			error?: string | null;
			chunk_count?: number;
		},
	): Promise<void> {
		const { error } = await supabase.from(FILES).update(patch).eq('id', id);
		if (error) throw new Error(error.message);
	}

	async removeFile(id: string): Promise<void> {
		// chunks caem via FK on delete cascade
		const { error } = await supabase.from(FILES).delete().eq('id', id);
		if (error) throw new Error(error.message);
	}

	async insertChunks(
		rows: Array<{
			instance_id: string;
			file_id: string;
			seq: number;
			content: string;
			tokens: number;
			embedding: number[] | null;
		}>,
	): Promise<void> {
		// Em lotes: linhas com vetor 1536 são grandes.
		const BATCH = 50;
		for (let i = 0; i < rows.length; i += BATCH) {
			const slice = rows.slice(i, i + BATCH).map((r) => ({
				...r,
				// pgvector aceita o literal '[1,2,...]' via string
				embedding: r.embedding ? JSON.stringify(r.embedding) : null,
			}));
			const { error } = await supabase.from(CHUNKS).insert(slice);
			if (error) throw new Error(error.message);
		}
	}

	async matchChunks(
		instanceId: string,
		embedding: number[],
		k = 5,
		minSimilarity = 0.25,
	): Promise<OmniKbMatch[]> {
		const { data, error } = await supabase.rpc('pl_omni_match_chunks', {
			p_instance_id: instanceId,
			p_query: JSON.stringify(embedding),
			p_k: k,
			p_min_similarity: minSimilarity,
		});
		if (error) throw new Error(error.message);
		return (data ?? []) as OmniKbMatch[];
	}

	async keywordChunks(
		instanceId: string,
		query: string,
		k = 5,
	): Promise<OmniKbMatch[]> {
		const { data, error } = await supabase.rpc('pl_omni_keyword_chunks', {
			p_instance_id: instanceId,
			p_query: query,
			p_k: k,
		});
		if (error) throw new Error(error.message);
		return (data ?? []) as OmniKbMatch[];
	}

	/** Nomes dos arquivos por id (pra rotular [Fonte: x.pdf] na resposta). */
	async fileNames(fileIds: string[]): Promise<Map<string, string>> {
		if (fileIds.length === 0) return new Map();
		const { data, error } = await supabase
			.from(FILES)
			.select('id, name')
			.in('id', [...new Set(fileIds)]);
		if (error) throw new Error(error.message);
		return new Map(
			((data ?? []) as Array<{ id: string; name: string }>).map((r) => [
				r.id,
				r.name,
			]),
		);
	}
}

export const omniKbRepository = new OmniKbRepository();
