import { cache } from './redis.js';

/**
 * Loader das ToolDefinitions (Fábrica de Tools). A definition publicada mora no
 * upvox; o motor genérico a carrega por `key` (mesmo padrão HTTP server-to-server
 * de `lib/upvox-tools.ts`: `EXTERNAL_API_URL` + `x-user-id` + Bearer repassado).
 * Cache de 60s (fail-open) pra não bater no upvox a cada run; só sucessos são
 * cacheados (erros propagam e não ficam grudados).
 */
const externalApiUrl = process.env.EXTERNAL_API_URL as string;

if (!externalApiUrl) {
	throw new Error('EXTERNAL_API_URL is not defined in .env');
}

/** Tipo de um input declarado na definition (estrutural; o bloco revalida). */
export interface InputSpec {
	type: 'image' | 'enum' | 'number' | 'int' | 'bool' | 'string';
	required?: boolean;
	default?: unknown;
	options?: unknown[];
	min?: number;
	max?: number;
	accept?: string[];
}

export interface PipelineNode {
	id: string;
	block: string;
	params?: Record<string, unknown>;
}

export interface ToolDefinitionDoc {
	schemaVersion?: number;
	input?: Record<string, InputSpec>;
	pipeline?: PipelineNode[];
	output?: Record<string, unknown>;
	ui?: Record<string, unknown>;
	billing?: {
		vox_cost: number | 'metered';
		free_quota?: Record<string, number | null>;
	};
}

export interface ToolDefinitionRow {
	tool_key: string;
	version: number;
	status: string;
	title: string;
	description: string | null;
	engine_runtime: string;
	definition: ToolDefinitionDoc;
}

/** Erro de carga da definition com status HTTP a propagar pro cliente. */
export class ToolDefinitionLoadError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = 'ToolDefinitionLoadError';
	}
}

/** Carrega a definition PUBLICADA por key (cacheada 60s). */
export async function loadPublishedToolDefinition(
	key: string,
	customerId: string,
	authHeader?: string,
): Promise<ToolDefinitionRow> {
	return cache.cacheAside(`tooldef:${key}:v1`, 60, async () => {
		const headers: Record<string, string> = {
			'x-user-id': customerId,
			'x-user-role': 'customer',
		};
		if (authHeader) headers.authorization = authHeader;

		const res = await fetch(
			`${externalApiUrl}/v1/tool-definition/${encodeURIComponent(key)}`,
			{ headers },
		);
		if (res.status === 404) {
			throw new ToolDefinitionLoadError(404, 'tool_not_found');
		}
		if (!res.ok) {
			throw new ToolDefinitionLoadError(
				502,
				`tool_definition_unavailable (HTTP ${res.status})`,
			);
		}
		return (await res.json()) as ToolDefinitionRow;
	});
}
