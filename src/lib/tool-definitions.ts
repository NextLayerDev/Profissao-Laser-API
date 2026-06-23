import { z } from 'zod';
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

/** Config de uma tool de "sala" (engine_runtime='room_v1' — Mentoria). */
/** Aparência personalizável de UMA tela da sala (aluno OU admin). Tudo opcional. */
export interface RoomScreenUi {
	accent?: string;
	theme?: 'app' | 'light' | 'dark';
	labels?: Record<string, string>;
	notice?: {
		type?: 'info' | 'warning' | 'success';
		title?: string;
		message?: string;
	} | null;
	sections?: { materials?: boolean; chat?: boolean };
}

export interface RoomConfig {
	cap?: number | null;
	schedule?: { opensMinutesBefore?: number; defaultDurationMin?: number };
	link?: { mode?: 'external' };
	features?: { recording?: boolean; chat?: boolean; materials?: boolean };
	access?: {
		includedPlanKeys?: string[];
		voxCost?: number;
		allowVoxEntry?: boolean;
	};
	/** Aparência personalizável por tela (aluno/admin). Opcional. */
	ui?: { customer?: RoomScreenUi; admin?: RoomScreenUi };
}

export interface ToolDefinitionDoc {
	schemaVersion?: number;
	input?: Record<string, InputSpec>;
	pipeline?: PipelineNode[];
	/** Presente só em tools de sala (room_v1). Pipeline tools omitem. */
	room?: RoomConfig;
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

/**
 * Schema estrutural de uma ToolDefinition inline (preview de rascunho do staff).
 * A definition publicada já é validada pelo upvox; a inline chega como JSON cru,
 * então validamos a forma aqui antes de rodar (o motor revalida cada bloco).
 */
const inlineDocSchema = z
	.object({
		schemaVersion: z.number().optional(),
		engine_runtime: z.string().optional(),
		input: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
		pipeline: z
			.array(
				z
					.object({
						id: z.string().min(1),
						block: z.string().min(1),
						params: z.record(z.string(), z.unknown()).optional(),
					})
					.passthrough(),
			)
			.optional(),
		output: z.record(z.string(), z.unknown()).optional(),
		ui: z.record(z.string(), z.unknown()).optional(),
		billing: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

/** Faz parse + valida a forma de uma definition inline (lança em JSON/forma inválida). */
export function parseInlineToolDefinition(raw: string): ToolDefinitionDoc {
	const json = JSON.parse(raw) as unknown;
	return inlineDocSchema.parse(json) as unknown as ToolDefinitionDoc;
}
