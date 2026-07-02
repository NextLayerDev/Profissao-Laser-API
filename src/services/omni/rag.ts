import { embedQuery } from '../../lib/omni/embeddings.js';
import { omniKbRepository } from '../../repositories/omni-kb.js';

/**
 * Busca na base de conhecimento (RAG): vetorial (pgvector, cosine) quando há
 * provedor de embeddings; fallback keyword (tsvector portuguese). Resultado já
 * formatado com a fonte, pronto pra injetar no contexto do turno.
 */
export async function searchKnowledge(
	instanceId: string,
	query: string,
	k = 5,
): Promise<string> {
	const trimmed = query.trim();
	if (!trimmed) return '';
	try {
		let matches = [] as Awaited<
			ReturnType<typeof omniKbRepository.matchChunks>
		>;
		const vec = await embedQuery(trimmed).catch(() => null);
		if (vec) {
			matches = await omniKbRepository.matchChunks(instanceId, vec, k, 0.25);
		}
		if (matches.length === 0) {
			matches = await omniKbRepository.keywordChunks(instanceId, trimmed, k);
		}
		if (matches.length === 0) return '';
		const names = await omniKbRepository.fileNames(
			matches.map((m) => m.file_id),
		);
		return matches
			.map(
				(m) =>
					`[Fonte: ${names.get(m.file_id) ?? 'base de conhecimento'}]\n${m.content}`,
			)
			.join('\n\n---\n\n');
	} catch (err) {
		console.error('[omni-rag] busca falhou:', err);
		return '';
	}
}
