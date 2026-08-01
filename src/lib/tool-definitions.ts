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
	/**
	 * `'file'` = arquivo NÃO-imagem (DXF, SVG, …). Chega como Buffer na bag,
	 * igual a `'image'`, mas é validado por EXTENSÃO (ver `accept`) em vez de
	 * mimetype, e não entra no fallback de "1 imagem única".
	 */
	type: 'image' | 'enum' | 'number' | 'int' | 'bool' | 'string' | 'file';
	required?: boolean;
	default?: unknown;
	options?: unknown[];
	min?: number;
	max?: number;
	/**
	 * Whitelist de extensões aceitas por um input `type:'file'` (sem o ponto:
	 * `['dxf','svg']`). Mimetype de CAD é caótico — o mesmo `.dxf` chega como
	 * `application/dxf`, `image/vnd.dxf`, `application/octet-stream` ou
	 * `text/plain` dependendo do sistema do aluno — então a extensão é o sinal
	 * confiável e o mimetype fica como sinal secundário.
	 */
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

/** Um campo do registro do banco (form do admin, gerado pelo front). */
export interface BankFieldSpec {
	name: string;
	label?: string;
	type: 'text' | 'textarea' | 'enum' | 'image';
	options?: string[];
	required?: boolean;
	placeholder?: string;
}

/**
 * "Banco do Admin" de uma tool. Quando `enabled`, o admin alimenta registros
 * (campos `fields`) e o cliente os consome como galeria; o registro escolhido é
 * injetado nos inputs do pipeline via `inject` (com substituição de `{var}`).
 */
export interface BankConfig {
	enabled?: boolean;
	fields?: BankFieldSpec[];
	/** De onde sai cada peça do card da galeria (path no registro, ex.: 'title'). */
	card?: {
		image?: string;
		title?: string;
		subtitle?: string;
		category?: string;
	};
	/** input → de onde vem (path 'data.x'/'title'…) + se substitui `{var}` dos campos do cliente. */
	inject?: Record<string, { from: string; substitute?: boolean }>;
}

/**
 * Um "Tipo de Criação" do Passo 1 (Prompts Mágicos). O cliente vê `label` + `icon`;
 * a resolução (`width`×`height`) é injetada no run por baixo dos panos via
 * `creation_id`. `active=false` oculta o card sem perder a definição.
 */
export interface Creation {
	/** Slug estável (ex.: `copos-360`); não muda após criado. */
	id: string;
	/** Nome amigável exibido no card (ex.: "Copos 360º"). */
	label: string;
	/** Nome do ícone (lucide) exibido acima do texto no card. Opcional. */
	icon?: string;
	/** Largura exata em px (injetada no `ai.generate_image`). */
	width: number;
	/** Altura exato em px (injetada no `ai.generate_image`). */
	height: number;
	/** Default true; false omite o card do cliente mas preserva o cadastro. */
	active?: boolean;
}

export interface ToolDefinitionDoc {
	schemaVersion?: number;
	input?: Record<string, InputSpec>;
	pipeline?: PipelineNode[];
	/** Presente só em tools de sala (room_v1). Pipeline tools omitem. */
	room?: RoomConfig;
	/** Banco do admin (galeria de registros). Opcional. */
	bank?: BankConfig;
	output?: Record<string, unknown>;
	ui?: Record<string, unknown>;
	billing?: {
		vox_cost: number | 'metered';
		free_quota?: Record<string, number | null>;
	};
	/**
	 * Override do modelo OpenRouter usado por `ai.generate_image`. Ausente =
	 * default do env (Gemini 3 Pro). Injetado pelo controller `tool-run.ts`
	 * nos params dos nós `ai.generate_image`.
	 */
	model?: string;
	/**
	 * System prompt opcional enviado ao `ai.generate_image`. SUBSTITUI (não
	 * concatena) o `DEFAULT_IMAGE_SYSTEM_PROMPT` laser. Ausente/vazio = default.
	 */
	system_prompt?: string;
	/**
	 * Dimensões EXATAS de saída (px) para `ai.generate_image`. Usadas por arte
	 * de gravação a laser (ex.: wrap 360°) onde a proporção precisa ser exata.
	 * O motor injeta a proporção no prompt E redimensiona a imagem final pra
	 * exatamente `image_width`×`image_height` (garantia via sharp). Ausente =
	 * saída nativa do modelo (quadrada na maioria).
	 */
	image_width?: number;
	image_height?: number;
	/**
	 * "Tipos de Criação" oferecidos ao cliente no Passo 1 (Prompts Mágicos).
	 * Cada item vira um card visual (ícone + nome amigável); a resolução
	 * (`width`×`height`) é HIDDEN do usuário e injetada no run via `creation_id`.
	 * Ausente/vazio → cai em `image_width/height` legado (ou saída nativa).
	 * `active=false` oculta o card mas preserva a definição.
	 */
	creations?: Creation[];
	/**
	 * Quantidades de variações oferecidas no Passo 3 (ex.: [1, 2, 4]).
	 * O PRIMEIRO elemento é o default selecionado. Ausente = [1] (sem escolha).
	 * 1 run = 1 billing independente de N — o admin oferece 2x/4x como benefício.
	 */
	return_variations?: number[];
	/**
	 * TRUE = `generateToolImage` manda SÓ a user message ao modelo, SEM
	 * intermediação (sem `DEFAULT_IMAGE_SYSTEM_PROMPT`, sem `TEXT_LEAD`). O
	 * sufixo `FORMATO OBRIGATÓRIO` continua indo (spec de formato, não de
	 * estilo). Quando o modelo suporta (catálogo `unifiedImagesApi:true`), a
	 * geração roteia pro endpoint dedicado da OpenRouter com
	 * `aspect_ratio`/`resolution`/`quality` reais; o sharp resize
	 * (`fit:'cover'`) garante a dimensão exata por cima disso. Escopado por
	 * tool — blocos IA extras (remover fundo, colorizar, restaurar) não
	 * recebem a flag e mantêm o comportamento atual.
	 */
	raw_prompt?: boolean;
	/**
	 * Override do modelo de TEXTO usado pelos nós `ai.text`. Espelha `model`
	 * (que é só de imagem). Validado contra `TEXT_MODELS_CATALOG` no
	 * `tool-run.ts`; id fora do catálogo cai no padrão com warning.
	 */
	text_model?: string;
	/**
	 * System prompt opcional dos nós `ai.text`. SUBSTITUI (não concatena) o
	 * `system` autorado no nó do pipeline — mesma semântica de `system_prompt`
	 * para imagem, para o admin conseguir ajustar o comportamento da tool sem
	 * reeditar o pipeline.
	 */
	text_system_prompt?: string;
	/**
	 * Datasets declarados por esta tool (ver `lib/tool-collections.ts`). É o
	 * ponto de extensão de DADO da Fábrica: uma ferramenta de catálogo inteira
	 * (Metallic, materiais, velocidades de corte) sai daqui sem código e sem
	 * DDL. `collections.default` é o `bank` legado.
	 */
	collections?: import('./tool-collections.js').CollectionsConfig;
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

/**
 * Carrega a definition por key (cacheada 60s).
 *
 * `includeDraft` só funciona para quem é admin do outro lado (a upvox valida o
 * papel; aqui só repassamos o pedido). Serve para a equipe exercitar uma tool
 * nova antes de publicá-la — o publish é ato de produção, porque o banco de
 * definitions é compartilhado dev/prod.
 *
 * A chave de cache MUDA quando se pede rascunho: sem isso, uma leitura de
 * staff gravaria o rascunho no cache que os alunos leem.
 */
export async function loadPublishedToolDefinition(
	key: string,
	customerId: string,
	authHeader?: string,
	includeDraft = false,
): Promise<ToolDefinitionRow> {
	const cacheKey = includeDraft
		? `tooldef:${key}:draft:v1`
		: `tooldef:${key}:v1`;
	return cache.cacheAside(cacheKey, 60, async () => {
		const headers: Record<string, string> = {
			'x-user-id': customerId,
			'x-user-role': includeDraft ? 'admin' : 'customer',
		};
		if (authHeader) headers.authorization = authHeader;

		const res = await fetch(
			`${externalApiUrl}/v1/tool-definition/${encodeURIComponent(key)}${includeDraft ? '?draft=1' : ''}`,
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
		bank: z.record(z.string(), z.unknown()).optional(),
		billing: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

/** Faz parse + valida a forma de uma definition inline (lança em JSON/forma inválida). */
export function parseInlineToolDefinition(raw: string): ToolDefinitionDoc {
	const json = JSON.parse(raw) as unknown;
	return inlineDocSchema.parse(json) as unknown as ToolDefinitionDoc;
}
