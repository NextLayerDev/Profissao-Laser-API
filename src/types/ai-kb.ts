/**
 * Tipos de RETRIEVAL do Cérebro da IA — o que a main API precisa para consumir
 * a busca.
 *
 * O Cérebro (tabelas, ingestão, sync, tela admin) vive na upvox API. A main API
 * só CONSOME a busca, então aqui ficam apenas os tipos da resposta de
 * `POST /v1/ai-knowledge/search`. Precisam espelhar o schema equivalente da
 * upvox (src/modules/ai-knowledge/schema.ts).
 */

export type KbSourceKind =
	| 'tool'
	| 'plan'
	| 'course'
	| 'lesson'
	| 'faq'
	| 'kb_article'
	| 'parameter'
	| 'machine'
	| 'laser_product'
	| 'fornecedor'
	| 'channel'
	| 'ticket'
	| 'manual';

export type KbTrust = 'trusted' | 'untrusted';
export type KbMode = 'vector' | 'keyword' | 'none';

export type KbDegradedReason =
	| 'ok'
	| 'empty_base'
	| 'empty_query'
	| 'disabled'
	| 'no_api_key'
	| 'embed_cooldown'
	| 'embed_failed'
	| 'embed_timeout'
	| 'rpc_error'
	| 'global_timeout'
	| 'unreachable';

export interface KbHit {
	chunkId: number;
	sourceId: string;
	title: string;
	kind: KbSourceKind;
	label: string | null;
	trust: KbTrust;
	content: string;
	score: number;
	pinned: boolean;
}

export interface KbSearchResult {
	context: string;
	hits: KbHit[];
	mode: KbMode;
	reason: KbDegradedReason;
	latencyMs: number;
}
