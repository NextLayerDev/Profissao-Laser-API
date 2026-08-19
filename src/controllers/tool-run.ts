import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { aiRodaDeGraca, nadaAPagarNesteRun } from '../lib/atelie/ajustes.js';
import { isStaffRole } from '../lib/external-auth.js';
import { IMAGE_MODELS_CATALOG } from '../lib/image-models-catalog.js';
import { TEXT_MODELS_CATALOG } from '../lib/text-models-catalog.js';
import {
	resolveCreation,
	resolveVariationCount,
	unidadesDaInvocacao,
	variacoesAEntregar,
} from '../lib/tool-creations.js';
import {
	type InputSpec,
	loadPublishedToolDefinition,
	type PipelineNode,
	parseInlineToolDefinition,
	type ToolDefinitionDoc,
	ToolDefinitionLoadError,
} from '../lib/tool-definitions.js';
import {
	coerceInputs,
	comPipeline,
	executeTool,
	selecionarPipeline,
	ToolEngineError,
} from '../lib/tool-engine.js';
import { isPreviewOnlyTool } from '../lib/tool-preview.js';
import {
	getToolVoxCost,
	liberarInvocacao,
	refundInvocation,
	reservarInvocacao,
	resolveToolBilling,
	settleInvocation,
} from '../lib/upvox-tools.js';
import { imageSizePresetRepository } from '../repositories/image-size-preset.js';
import { emitirLicenca } from '../repositories/licensed-art.js';
import { toolBankRepository } from '../repositories/tool-bank.js';
import { registerCoreBlocks } from '../tool-blocks/index.js';
import type { ToolBankEntry } from '../types/tool-bank.js';
import { bankImageSizeSchema, resolveImageSizePx } from '../types/tool-bank.js';

// Garante que os blocos curados estejam no registry (idempotente).
registerCoreBlocks();

// Tipos de imagem aceitos (alinhado ao que o sharp decodifica) — mesma lista do
// laser-prep. Só aplicado quando o run inclui um arquivo.
const ALLOWED_IMAGE_MIME = new Set([
	'image/png',
	'image/jpeg',
	'image/jpg',
	'image/webp',
	'image/gif',
	'image/bmp',
	'image/tiff',
	'image/avif',
]);

/**
 * Extensões aceitas por padrão num input `type:'file'` que não declara
 * `accept`. Whitelist, nunca blacklist. Formatos de CAD/vetor/dados que os
 * blocos sabem ler — nada executável.
 */
const ALLOWED_FILE_EXT = new Set(['dxf', 'svg', 'lbrn2', 'csv', 'json', 'txt']);

/**
 * Teto por ARQUIVO. O `@fastify/multipart` está registrado globalmente com
 * `fileSize: 1.5GB` (server.ts) — o que faz sentido para upload de vídeo de
 * aula, e nenhum para input de tool. Sem este teto, um único run poderia
 * carregar 1,5 GB em memória.
 */
const MAX_FILE_BYTES =
	Number(process.env.TOOL_MAX_FILE_BYTES) || 25 * 1024 * 1024;

interface ToolRunParams {
	key: string;
}

/** Extensão em minúsculas, sem ponto. `''` quando o nome não tem extensão. */
function extOf(filename: string): string {
	const i = filename.lastIndexOf('.');
	return i === -1 ? '' : filename.slice(i + 1).toLowerCase();
}

/**
 * Valida cada arquivo enviado CONTRA O SPEC DO SEU INPUT.
 *
 * Antes esta checagem era global (`todo arquivo precisa ser imagem`), o que
 * tornava impossível uma tool receber um DXF. Agora:
 *   - input `type:'image'` → mimetype na whitelist de imagem (como antes);
 *   - input `type:'file'`  → EXTENSÃO na whitelist do `accept` do input (ou na
 *     padrão). Mimetype é ignorado de propósito: o mesmo `.dxf` chega como
 *     `application/dxf`, `image/vnd.dxf`, `application/octet-stream` ou
 *     `text/plain` conforme o sistema do aluno, e confiar nele rejeitaria
 *     uploads legítimos;
 *   - arquivo enviado para um fieldname que não é input de arquivo → rejeitado
 *     (não deixamos payload não declarado entrar).
 *
 * Devolve a mensagem de erro (PT-BR, mostrada ao aluno) ou `null` se está tudo
 * certo. A validação por extensão é mais fraca que por conteúdo — a defesa real
 * é o bloco que lê o arquivo e falha em conteúdo inválido, mais o teto de bytes.
 */
function validateUploadedFiles(
	inputSpec: Record<string, InputSpec>,
	files: Record<string, Buffer>,
	mimes: Record<string, string>,
	names: Record<string, string>,
): string | null {
	for (const [field, buf] of Object.entries(files)) {
		if (buf.byteLength > MAX_FILE_BYTES) {
			const mb = Math.floor(MAX_FILE_BYTES / (1024 * 1024));
			return `Arquivo '${field}' excede o limite de ${mb} MB.`;
		}

		const spec = inputSpec[field];
		// Fieldname genérico com UM input de imagem: é o fallback legado do motor
		// (`coerceInputs`), então precisa continuar passando aqui.
		if (!spec) {
			const imageInputs = Object.values(inputSpec).filter(
				(s) => s.type === 'image',
			);
			if (
				imageInputs.length === 1 &&
				Object.keys(files).length === 1 &&
				ALLOWED_IMAGE_MIME.has(mimes[field] ?? '')
			) {
				continue;
			}
			return `Arquivo inesperado em '${field}'.`;
		}

		if (spec.type === 'image') {
			if (!ALLOWED_IMAGE_MIME.has(mimes[field] ?? '')) {
				return `Tipo de arquivo não suportado em '${field}' (envie PNG/JPG/WEBP).`;
			}
			continue;
		}

		if (spec.type === 'file') {
			const allowed = new Set(
				(spec.accept ?? [...ALLOWED_FILE_EXT]).map((e) =>
					e.replace(/^\./, '').toLowerCase(),
				),
			);
			const ext = extOf(names[field] ?? '');
			if (!ext || !allowed.has(ext)) {
				const list = [...allowed].map((e) => `.${e}`).join(', ');
				return `Tipo de arquivo não suportado em '${field}' (aceita: ${list}).`;
			}
			continue;
		}

		return `O campo '${field}' não aceita arquivo.`;
	}
	return null;
}

/** Junta mimetype + filename por fieldname para o motor publicar na bag. */
function buildFileMeta(
	mimes: Record<string, string>,
	names: Record<string, string>,
): Record<string, { filename?: string; mime?: string }> {
	const meta: Record<string, { filename?: string; mime?: string }> = {};
	for (const field of new Set([...Object.keys(mimes), ...Object.keys(names)])) {
		meta[field] = { mime: mimes[field], filename: names[field] };
	}
	return meta;
}

/** Resolve um path do registro do banco: `data.x` → entry.data.x; senão coluna. */
function resolveBankPath(entry: ToolBankEntry, path: string): unknown {
	if (path.startsWith('data.')) {
		return entry.data?.[path.slice('data.'.length)];
	}
	return (entry as unknown as Record<string, unknown>)[path];
}

/** Lê `data.image_size_px` (gravado pelo admin via `bankImageSizeSchema`) do item do banco. */
function bankImageSize(
	entry: ToolBankEntry | undefined,
): { width: number; height: number } | undefined {
	const size = (entry?.data as Record<string, unknown> | undefined)
		?.image_size_px as { width?: unknown; height?: unknown } | undefined;
	if (
		typeof size?.width === 'number' &&
		typeof size?.height === 'number' &&
		size.width > 0 &&
		size.height > 0
	) {
		return { width: size.width, height: size.height };
	}
	return undefined;
}

/** Troca `{var}` pelos campos do cliente; deixa o placeholder se faltar a var. */
function substituteVars(template: string, ctx: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (_m, k: string) =>
		ctx[k] !== undefined ? ctx[k] : `{${k}}`,
	);
}

/**
 * Valida um id de modelo contra um catálogo curado. Id fora do catálogo (admin
 * digitou errado, ou o modelo foi removido do catálogo depois do save) devolve
 * `undefined` + warning: o bloco cai no default do sistema, em vez de mandarmos
 * um id inválido pro OpenRouter e quebrarmos uma invocação já cobrada.
 */
function validateModelId(
	id: string | undefined,
	catalogIds: Set<string>,
	field: string,
	catalogName: string,
): string | undefined {
	if (!id) return undefined;
	if (catalogIds.has(id)) return id;
	console.warn(
		`[tool-run] ${field} '${id}' não está no catálogo curado — caindo no default. Atualize o ${catalogName} ou remova o override.`,
	);
	return undefined;
}

/**
 * Blocos de geração de imagem que recebem os overrides da tool. `ai.image_studio`
 * (Estúdio de Imagens) entra aqui pelo mesmo motivo do `ai.generate_image`: o
 * admin escolhe o modelo por tool na Fábrica, e sem esta lista a escolha dele
 * simplesmente não chegaria ao bloco. Os params que o Estúdio não declara
 * (`variation_count`) são descartados pelo schema — `z.object` faz `strip`.
 */
const IMAGE_GEN_BLOCKS = new Set(['ai.generate_image', 'ai.image_studio']);

/**
 * Os blocos que SABEM gerar N variações — não os que recebem o override.
 *
 * A diferença entre as duas listas é o que impede "cobrar 4 e entregar 1":
 * `ai.image_studio` está em `IMAGE_GEN_BLOCKS` (recebe modelo/tamanho do admin)
 * mas o schema dele não declara `variation_count`, então o `z.object` faz
 * `strip` e o número some sem um ruído sequer. Só `ai.generate_image`
 * (`blocks/ai.ts`: `variation_count` declarado, N chamadas ao modelo) entrega.
 *
 * Ensinar o Estúdio a fazer N é uma mudança legítima — e no dia em que ela
 * acontecer, o id entra aqui junto com o schema, no mesmo commit.
 */
const BLOCOS_QUE_FAZEM_VARIACOES = new Set(['ai.generate_image']);

/** `true` se algum nó deste fluxo sabe honrar `variation_count > 1`. */
function pipelineEntregaVariacoes(
	nodes: readonly { block: string }[],
): boolean {
	return nodes.some((n) => BLOCOS_QUE_FAZEM_VARIACOES.has(n.block));
}

/**
 * Injeta overrides per-tool nos `params` dos nós de IA do pipeline:
 *   - `ai.generate_image` / `ai.image_studio`
 *                          ← `definition.model` / `system_prompt` / `image_*`
 *                          ← `definition.creations[creation_id]` (Passo 1)
 *                          ← `variationCount` (já resolvido e RECONCILIADO com
 *                             o que a invocação pagou — ver `executarRun`)
 *                          ← `definition.raw_prompt` (sem intermediação)
 *   - `ai.text`           ← `definition.text_model` / `text_system_prompt`
 *
 * `variationCount` chega PRONTO de propósito: quem o resolve precisa rodar
 * antes do gate de billing (para recusar sem cobrar) e ser comparado com o
 * `voxes_spent` da invocação depois dele (para não gerar N tendo cobrado 1).
 * Calculá-lo aqui dentro, como era antes, escondia o número do único lugar que
 * tem a resposta do upvox na mão.
 *
 * `fields` carrega `creation_id` (multipart string do request). A validação
 * aqui é ANTES do gate de billing → erro 400 rejeita sem cobrar (sem refund
 * necessário).
 *
 * Fast-path: sem nenhum override setado, devolve o doc intacto (zero impacto
 * retrocompatível nas ~100 tools publicadas).
 *
 * Decisão de arquitetura 2026-07-10: per-tool override na definition, NÃO
 * per-bank-entry. A tool vence sobre override de nó (ordem do spread: primeiro
 * `n.params`, depois o override da tool). Se o admin setar `params.model` no
 * nó, a tool sobrescreve — na prática admin não seta model por nó.
 *
 * `doc.model` é validado contra o catálogo curado (`IMAGE_MODELS_CATALOG`).
 * Se o admin digitou um id fora do catálogo (ou um modelo foi removido do
 * catálogo após o save), logamos warning e CAÍMOS NO DEFAULT DO SISTEMA — em
 * vez de mandar um id inválido pro OpenRouter e quebrar a invocação.
 *
 * Prioridade de TAMANHO (reconciliado 2026-08-01 entre o Passo 1 de creations
 * e o `image_size_presets` já em dev): `clientSizeOverride` (campo `image_size`
 * enviado pelo cliente na chamada, resolvido contra `imageSizePresetRepository`)
 * vence TUDO — `'native'` é pedido EXPLÍCITO do cliente pra manter o tamanho
 * nativo da IA (sem redimensionar), removendo `width`/`height` do node mesmo
 * que tool/creation/banco tenham definido um. Na ausência dele, `creation_id`
 * (Passo 1 — "Tipo de criação" resolvido via `doc.creations`) vence o tamanho
 * do item do banco (`bankSizeOverride`, `data.image_size_px`), que por sua vez
 * vence o default da tool (`doc.image_width/height`).
 */
function injectModelOverrides(
	doc: ToolDefinitionDoc,
	fields: Record<string, string>,
	variationCount: number,
	bankSizeOverride?: { width: number; height: number },
	clientSizeOverride?: { width: number; height: number } | 'native',
): ToolDefinitionDoc {
	const toolModel = validateModelId(
		doc.model,
		new Set(IMAGE_MODELS_CATALOG.map((m) => m.id)),
		'doc.model',
		'IMAGE_MODELS_CATALOG',
	);
	const toolTextModel = validateModelId(
		doc.text_model,
		new Set(TEXT_MODELS_CATALOG.map((m) => m.id)),
		'doc.text_model',
		'TEXT_MODELS_CATALOG',
	);
	const toolSystemPrompt = doc.system_prompt;
	const toolTextSystemPrompt = doc.text_system_prompt;

	const clientNative = clientSizeOverride === 'native';
	const clientPx = clientNative ? undefined : clientSizeOverride;

	// ── creations (Passo 1): resolve creation_id → {width, height}, sobrepondo
	// image_width/height legado. Tool sem creations ignora o passo (legado). ──
	const creations = doc.creations ?? [];
	const creationSize = resolveCreation(doc, fields.creation_id);

	const w = clientNative
		? undefined
		: (clientPx?.width ??
			creationSize.width ??
			bankSizeOverride?.width ??
			doc.image_width);
	const h = clientNative
		? undefined
		: (clientPx?.height ??
			creationSize.height ??
			bankSizeOverride?.height ??
			doc.image_height);
	const hasSize =
		typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0;

	const useRawPrompt = !!doc.raw_prompt;

	/**
	 * `variationCount > 1` ENTRA AQUI, e a ausência dele era um cobra-N-entrega-1
	 * silencioso: a injeção do `variation_count` mora dentro deste `if`, então
	 * uma tool com `return_variations` mas SEM modelo/system prompt/tamanho/
	 * raw_prompt fixados na Fábrica cobrava 2× ou 4× e o número nunca chegava ao
	 * bloco — o motor gerava uma imagem e liquidava a invocação cheia. Era
	 * anterior a este trabalho e não aparecia porque a única tool com Passo 3
	 * publicada (`prompts_magicos`) por acaso também fixa o modelo.
	 */
	const hasImageOverride =
		!!toolModel ||
		!!toolSystemPrompt ||
		hasSize ||
		useRawPrompt ||
		clientNative ||
		variationCount > 1;
	const hasTextOverride = !!toolTextModel || !!toolTextSystemPrompt;
	if (
		!hasImageOverride &&
		!hasTextOverride &&
		variationCount <= 1 &&
		creations.length === 0
	) {
		return doc;
	}

	/**
	 * Aplica os overrides a UM pipeline. Extraída porque a tool pode ter mais de
	 * um fluxo (`pipelines`), e o modelo/tamanho/system prompt que o admin fixou
	 * na Fábrica valem para a ferramenta INTEIRA — não só para o fluxo padrão.
	 * Sem isto, o Ateliê geraria a arte com o modelo escolhido e ajustaria com
	 * outro, em silêncio.
	 */
	const aplicar = (nodes: ToolDefinitionDoc['pipeline'] = []) =>
		nodes.map((n) => {
			if (IMAGE_GEN_BLOCKS.has(n.block) && hasImageOverride) {
				const params: Record<string, unknown> = { ...(n.params ?? {}) };
				if (toolModel) params.model = toolModel;
				if (toolSystemPrompt) params.system_prompt = toolSystemPrompt;
				if (hasSize) {
					params.width = w;
					params.height = h;
				} else if (clientNative) {
					delete params.width;
					delete params.height;
				}
				if (useRawPrompt) params.raw_prompt = true;
				if (variationCount > 1) params.variation_count = variationCount;
				return { ...n, params };
			}
			if (n.block === 'ai.text' && hasTextOverride) {
				return {
					...n,
					params: {
						...(n.params ?? {}),
						...(toolTextModel ? { model: toolTextModel } : {}),
						...(toolTextSystemPrompt ? { system: toolTextSystemPrompt } : {}),
					},
				};
			}
			return n;
		});

	return {
		...doc,
		pipeline: aplicar(doc.pipeline),
		...(doc.pipelines
			? {
					pipelines: Object.fromEntries(
						Object.entries(doc.pipelines).map(([nome, nos]) => [
							nome,
							aplicar(nos),
						]),
					),
				}
			: {}),
	};
}

/**
 * Valida `variation_count` (campo multipart string) contra o allowlist de
 * `definition.return_variations`. Default = 1º elemento (ou 1 se vazio).
 * Lança `ToolEngineError(400)` se vier valor fora do permitido — antes do
 * billing, então o cliente não paga por escolha inválida. (Reexportado de
 * `lib/tool-creations` pra teste isolado — ver `tests/tool-run-creations.test.ts`.)
 */

/**
 * Motor genérico `POST /api/tool-run/:key`. Espelha o `laserPrepController`:
 * lê multipart → carrega a definition (published por key; ou inline draft p/
 * staff em preview) → gate de billing (upvox) → roda o pipeline de blocos →
 * settle/refund. Billing é AUTORITATIVO no upvox; o motor não dá run grátis a
 * tool cobrada sem invocation válida.
 */

/** O que a resposta devolve ao front quando a arte é licenciada. */
interface IssuedArtLicense {
	code: string;
	featureKey: string;
	licensorName: string | null;
	issuedAt: string;
}

/**
 * Prompt licenciado é prompt que carrega `feature_key` no `data`.
 *
 * O gatilho é o DADO e não uma flag na definition: o staff amarra a marca ao
 * prompt, e nenhuma configuração de tool pode desligar a emissão por engano.
 */
function licenseFeatureKeyOf(entry?: ToolBankEntry): string | null {
	const bruto = (entry?.data as Record<string, unknown> | undefined)
		?.feature_key;
	if (typeof bruto !== 'string') return null;
	const chave = bruto.trim().toLowerCase();
	// Mesma gramática do resto da casa. Fora do formato é erro de cadastro, e
	// tratamos como "não licenciado" — melhor não emitir do que emitir com marca
	// inválida.
	return /^[a-z0-9]+:[a-z0-9-]+$/.test(chave) ? chave : null;
}

/** Nome de gente da marca, para a tela pública não mostrar `clube:corinthians`. */
function licensorNameOf(entry?: ToolBankEntry): string | null {
	const bruto = (entry?.data as Record<string, unknown> | undefined)
		?.licensor_name;
	return typeof bruto === 'string' && bruto.trim() ? bruto.trim() : null;
}

/**
 * A URL da arte dentro da saída do pipeline.
 *
 * O nome do campo de saída é escolhido na definition e varia por tool, então
 * procuramos a primeira URL http(s) em vez de fixar uma chave — fixar quebraria
 * em silêncio na primeira tool que nomeasse diferente.
 */
function firstUrlOf(output: Record<string, unknown>): string | null {
	for (const valor of Object.values(output)) {
		if (typeof valor === 'string' && /^https?:\/\//.test(valor)) return valor;
		if (Array.isArray(valor)) {
			const achado = valor.find(
				(v) => typeof v === 'string' && /^https?:\/\//.test(v),
			);
			if (typeof achado === 'string') return achado;
		}
	}
	return null;
}

/**
 * Um "respondedor": ou a resposta HTTP normal, ou frames SSE.
 *
 * Existe para que a rota de STREAMING e a normal compartilhem o MESMO caminho
 * de billing (gate → executa → settle/refund). Duplicar o controller para ter
 * SSE duplicaria justamente a parte perigosa — a que mexe em voxxy.
 */
interface Respondedor {
	erro(status: number, message: string): unknown;
	ok(payload: unknown): unknown;
	progresso?: (ev: Record<string, unknown>) => void;
}

async function executarRun(
	request: FastifyRequest,
	res: Respondedor,
): Promise<unknown> {
	const customerId = request.currentCustomer?.id;
	const authHeader = request.headers.authorization;
	let invocationId: string | null = null;
	/** Recibo que ESTE run tomou (ver `reservarInvocacao`); devolvido no `finally`. */
	let reservado: string | null = null;

	try {
		if (!customerId) {
			return res.erro(403, 'Customer not found');
		}

		const { key } = request.params as ToolRunParams;

		// ── multipart: N arquivos por fieldname (opcionais) + campos string ──
		// Mapeia cada arquivo pelo SEU fieldname (ex.: `referencia`, `referencia2`)
		// pra o motor casar cada input de imagem com seu arquivo. A validação de
		// tipo roda por arquivo, contra o spec do input correspondente.
		// `fileNames` é necessário para inputs `type:'file'`, validados por
		// extensão (mimetype de CAD é caótico e não serve de fonte de verdade).
		const files: Record<string, Buffer> = {};
		const fileMimes: Record<string, string> = {};
		const fileNames: Record<string, string> = {};
		const fields: Record<string, string> = {};
		for await (const part of request.parts()) {
			if (part.type === 'file') {
				files[part.fieldname] = await part.toBuffer();
				fileMimes[part.fieldname] = part.mimetype;
				fileNames[part.fieldname] = part.filename ?? '';
			} else {
				fields[part.fieldname] = part.value as string;
			}
		}

		/**
		 * ┌─ "400 ANTES DO PORTÃO REJEITA SEM COBRAR" ERA MENTIRA ──────────────┐
		 * │ Três comentários deste arquivo diziam isso, e o desenho inteiro da  │
		 * │ ordem das validações se apoiava nele. A cobrança NÃO acontece aqui: │
		 * │ ela já aconteceu no `/invoke`, no cliente, ANTES deste request      │
		 * │ existir (`use-run-tool.ts` debita e só então chama o motor). Todo   │
		 * │ 400 devolvido antes do portão deixava a invocação `pending` com o   │
		 * │ voxxy debitado — e o front não estorna, e o upvox não tem reaper:   │
		 * │ `pending` é terminal na prática. Medido: 7 valores inválidos de     │
		 * │ `variation_count` = 7 invocações presas.                            │
		 * │                                                                      │
		 * │ `recusar` é a saída de erro correta destas validações: responde o   │
		 * │ 400 E devolve o dinheiro. O upvox escopa o refund ao DONO da        │
		 * │ invocação, então um id forjado/alheio simplesmente não estorna nada. │
		 * └──────────────────────────────────────────────────────────────────────┘
		 */
		const reciboDoCliente = fields.invocation_id?.trim() || undefined;

		/**
		 * A TRAVA DE RECIBO, tomada aqui no começo por dois motivos que se
		 * reforçam. Ver `reservarInvocacao` para o furo que ela fecha (o mesmo
		 * recibo passando no portão K vezes em paralelo, K× o fornecedor por uma
		 * cobrança). E, tomada ANTES das validações, ela é o que torna o estorno
		 * do `recusar` seguro: só estornamos um recibo que é comprovadamente
		 * NOSSO, nunca um que está sendo usado por um run legítimo em voo.
		 */
		if (reciboDoCliente) {
			if (!reservarInvocacao(reciboDoCliente)) {
				return res.erro(
					409,
					'Esta geração já está sendo processada. Aguarde o resultado — não é preciso gerar de novo.',
				);
			}
			reservado = reciboDoCliente;
		}

		const recusar = async (status: number, message: string) => {
			if (reservado) {
				await refundInvocation(customerId, reservado, authHeader);
				invocationId = null;
			}
			return res.erro(status, message);
		};

		// ── definition: inline draft (preview de staff) OU published por key ──
		const isStaff = isStaffRole(request.currentRole);
		let doc: ToolDefinitionDoc;
		let runtime = 'blocks_v1';
		let billed = true;
		/**
		 * A MINA DO DIA DA PUBLICAÇÃO. `TOOL_PREVIEW_KEYS` faz o upvox APAGAR a
		 * tool da resposta de entitlements de quem não é testador — e o motor
		 * decide se cobra com `isToolBilled`, que é exatamente "está na lista de
		 * entitlements?". Enquanto a definition é `draft`, o escudo é o 404 da
		 * carga. No instante em que a tool for PUBLICADA ainda listada na env, o
		 * escudo some e ela passa a rodar `mode:'free'` — de graça, para todo
		 * mundo, com o fornecedor no nosso bolso.
		 *
		 * Publicar e tirar da env são dois passos em sistemas diferentes, feitos
		 * por gente com pressa. Isto transforma a janela entre eles num erro
		 * barulhento em vez de numa torneira aberta.
		 */
		let publicadaAindaEmPreview = false;

		if (fields.definition) {
			// Preview de rascunho: só staff, e NÃO cobra (sem invocation).
			if (!isStaff) {
				return recusar(403, 'inline_definition_forbidden');
			}
			try {
				// Valida a forma da definition inline (JSON + estrutura) antes de rodar.
				doc = parseInlineToolDefinition(fields.definition);
			} catch {
				return recusar(400, 'definition inválida');
			}
			runtime =
				(doc as { engine_runtime?: string }).engine_runtime ?? 'blocks_v1';
			billed = false;
		} else {
			const row = await loadPublishedToolDefinition(
				key,
				customerId,
				authHeader,
			);
			doc = row.definition;
			runtime = row.engine_runtime;
			publicadaAindaEmPreview =
				row.status === 'published' && isPreviewOnlyTool(key);
		}

		if (runtime !== 'blocks_v1') {
			return recusar(
				400,
				`engine_runtime '${runtime}' não suportado (MVP: blocks_v1)`,
			);
		}

		// ── banco do admin (opcional): injeta o registro escolhido nos inputs ──
		const bank = doc.bank;
		let selectedBankEntry: ToolBankEntry | undefined;
		if (bank?.enabled) {
			const bankEntryId = fields.bank_entry_id;
			if (!bankEntryId) {
				// Staff em preview (billed=false) pode testar sem escolher um item.
				if (billed) {
					return recusar(400, 'Escolha um item do banco.');
				}
			} else {
				const entry = await toolBankRepository.findById(bankEntryId, key, {
					activeOnly: !isStaff,
				});
				if (!entry) {
					return recusar(400, 'Item do banco inválido.');
				}
				selectedBankEntry = entry;
				const injectMap: Record<
					string,
					{ from: string; substitute?: boolean }
				> = bank.inject ?? {};
				for (const [inputName, rule] of Object.entries(injectMap)) {
					const value = resolveBankPath(entry, rule.from);
					if (value === undefined || value === null) continue;
					let str = typeof value === 'string' ? value : JSON.stringify(value);
					if (rule.substitute) str = substituteVars(str, fields);
					const name = inputName.startsWith('input.')
						? inputName.slice('input.'.length)
						: inputName;
					fields[name] = str;
				}
			}
		}

		// Tamanho escolhido pelo CLIENTE na hora da geração (`image_size`) — vence
		// banco e tool. `"native"` mantém o tamanho nativo gerado pela IA (sem
		// redimensionar); qualquer outro valor é JSON no formato do banco (px | mm | preset).
		let clientSize: { width: number; height: number } | 'native' | undefined;
		if (fields.image_size === 'native') {
			clientSize = 'native';
		} else if (fields.image_size) {
			let parsedSize: unknown;
			try {
				parsedSize = JSON.parse(fields.image_size);
			} catch {
				return recusar(400, 'image_size inválido (JSON).');
			}
			const parsed = bankImageSizeSchema.safeParse(parsedSize);
			if (!parsed.success) {
				return recusar(400, 'image_size inválido.');
			}
			try {
				clientSize = await resolveImageSizePx(parsed.data, async (id) =>
					imageSizePresetRepository.findById(id),
				);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : 'image_size inválido.';
				return recusar(400, message);
			}
		}

		/**
		 * QUANTAS VARIAÇÕES O CLIENTE PEDIU (Passo 3). É só o PEDIDO: o número
		 * que o motor vai de fato entregar sai depois do portão, reconciliado
		 * com o que a invocação pagou (`variacoesAEntregar`).
		 */
		const allowedVariations = doc.return_variations ?? [1];
		let variationCount: number;
		try {
			variationCount = resolveVariationCount(
				fields.variation_count,
				allowedVariations,
			);
		} catch (err) {
			const message =
				err instanceof ToolEngineError
					? err.message
					: 'Quantidade de variações inválida.';
			return recusar(400, message);
		}

		/**
		 * QUAL FLUXO. A validação continua antes do portão — não porque "400
		 * aqui não cobra" (não é verdade; ver `recusar`), mas porque não faz
		 * sentido consultar o upvox para um pedido que já sabemos malformado.
		 * O estorno de quem já pagou é responsabilidade do `recusar`.
		 *
		 * `doc` aqui ainda é o CRU, sem os overrides — e pode ser: a seleção de
		 * fluxo olha os NOMES dos pipelines e `nadaAPagarNesteRun` olha
		 * `block`/`params.mode`, e o override só mexe em model/system_prompt/
		 * tamanho/raw_prompt/variation_count dos nós de imagem.
		 */
		const flow = fields.flow?.trim() || undefined;
		let doFluxo: PipelineNode[];
		try {
			doFluxo = selecionarPipeline(doc, flow);
		} catch (err) {
			const message =
				err instanceof ToolEngineError ? err.message : 'fluxo inválido';
			return recusar(400, message);
		}

		/**
		 * NÃO COBRAR POR TRABALHO QUE NÃO CUSTOU.
		 *
		 * Ver `nadaAPagarNesteRun`. O caso real é `flow=ajustar&modo=ampliar`, que
		 * é `resize` Lanczos na nossa CPU e tem rota grátis pronta — a tela já
		 * manda por ela; esta guarda é o que garante que ela seja a ÚNICA porta.
		 * E `recusar` devolve o voxxy de quem chegou aqui já debitado.
		 */
		if (billed && nadaAPagarNesteRun(doFluxo, fields)) {
			return recusar(
				400,
				'Este ajuste é feito aqui mesmo, sem gastar voxxy — ele não passa por esta rota. Use o ajuste pela tela.',
			);
		}

		/**
		 * VALIDA O PASSO 1 ANTES DE QUALQUER TRABALHO. `resolveCreation` roda de
		 * novo dentro do `injectModelOverrides` (é puro e barato); aqui ele existe
		 * só para que um `creation_id` ausente/inválido saia como 400 COM estorno,
		 * em vez de escapar pelo catch externo — que só conhecia
		 * `ToolDefinitionLoadError` e transformava este 400 em **HTTP 500**, com
		 * mensagem de usuário e voxxy preso.
		 */
		try {
			resolveCreation(doc, fields.creation_id);
		} catch (err) {
			const message =
				err instanceof ToolEngineError
					? err.message
					: 'Tipo de criação inválido.';
			return recusar(400, message);
		}

		// ── billing (autoritativo no upvox) ──
		if (billed) {
			const gate = await resolveToolBilling(
				customerId,
				key,
				fields.invocation_id ?? null,
				authHeader,
			);
			if (gate.mode === 'reject') {
				return recusar(gate.status, gate.message);
			}
			if (gate.mode === 'free' && publicadaAindaEmPreview) {
				console.error(
					`[tool-run] ${key} está PUBLICADA e ainda em TOOL_PREVIEW_KEYS — o upvox a esconde dos entitlements e o motor rodaria de graça. Tire a key da env nos DOIS serviços.`,
				);
				return recusar(402, 'billing_required');
			}
			invocationId = gate.mode === 'paid' ? gate.invocationId : null;

			/**
			 * ┌─ PAGOU POR UMA, PEDIU QUATRO ───────────────────────────────────────┐
			 * │ O `/invoke` do upvox debita `vox_cost × variation_count` e devolve  │
			 * │ um id. O run conferia `variation_count` só contra                   │
			 * │ `return_variations` da definition — o allowlist do que a tool PODE  │
			 * │ entregar, nunca do que ESTE run pagou. Bastava pedir 1 no `/invoke` │
			 * │ e 4 aqui: o motor aceitava, chamava o fornecedor quatro vezes e     │
			 * │ liquidava a invocação de uma. Medido ao vivo nos Prompts Mágicos    │
			 * │ (publicado): US$ 1,20 de fornecedor por clique, repetível.          │
			 * └──────────────────────────────────────────────────────────────────────┘
			 *
			 * O motor ENTREGA O QUE FOI PAGO — não recusa. A recusa (409) fechava a
			 * fraude e abria a falha oposta: qualquer deriva entre as duas chamadas
			 * (aba com bundle velho, retry, segunda aba) virava erro num run
			 * legítimo já cobrado — e isso foi observado com um cliente real. Ver a
			 * caixa em `variacoesAEntregar`.
			 *
			 * A pergunta ao upvox só acontece com `variationCount > 1`: com uma
			 * variação não há o que reconciliar, e assim a esmagadora maioria dos
			 * runs (toda tool sem `return_variations`, todo 1×) não ganha nem uma
			 * chamada de rede nem uma superfície nova de falha.
			 */
			if (gate.mode === 'paid' && variationCount > 1) {
				// O upvox agora GUARDA quantas unidades a rodada comprou. Só quando
				// a invocação é anterior à coluna é que voltamos a inferir pelo valor
				// pago — e aí o `vox_cost` precisa ser buscado, uma ida a menos ao
				// upvox no caminho quente de todo mundo.
				// "Tem número guardado?", não "é exatamente null": uma invocação
				// anterior à coluna chega com o campo ausente, e tratar `undefined`
				// como "sei o número" faria o motor entregar sem conferir nada.
				const temUnidades = typeof gate.units === 'number' && gate.units >= 1;
				const voxCost = temUnidades
					? null
					: await getToolVoxCost(customerId, key, authHeader);
				const pagas = unidadesDaInvocacao({
					units: gate.units,
					voxesSpent: gate.voxesSpent,
					quotaConsumed: gate.quotaConsumed,
					voxCost,
				});
				const entregar = variacoesAEntregar(
					variationCount,
					pagas,
					allowedVariations,
				);
				if (pagas === null) {
					// Indeterminado, e só possível em invocação anterior à coluna
					// `units` (cota do plano, conta ilimitada, preço mexido no meio do
					// caminho). Entrega o pedido — ver `variacoesPagas`.
					console.warn(
						`[tool-run] ${key}: ${variationCount} variações sem conferência possível (voxes_spent=${gate.voxesSpent}, quota=${gate.quotaConsumed}, vox_cost=${voxCost ?? 'desconhecido'}).`,
					);
				} else if (entregar < variationCount) {
					// Log alto: se isto aparecer em volume, é bug de cliente (invoke e
					// run derivando N de fontes diferentes), não fraude.
					console.warn(
						`[tool-run] ${key}: pedido de ${variationCount} variações sobre invocação de ${pagas} (voxes_spent=${gate.voxesSpent}, vox_cost=${voxCost}) — entregando ${entregar}.`,
					);
				}
				variationCount = entregar;
			}
		}

		/**
		 * COBRAR N E ENTREGAR 1 — a mesma falha do furo, virada do avesso.
		 *
		 * Os overrides só chegam nos nós de imagem, e nem todo bloco de imagem
		 * sabe fazer N (`ai.image_studio` não sabe: o Zod dele faz `strip` da
		 * chave). Uma tool que declare `return_variations` e rode num bloco
		 * desses cobraria 2× ou 4× e devolveria uma imagem só, em silêncio.
		 * Aqui isso vira recusa COM ESTORNO: é erro de configuração do admin,
		 * e o único desfecho aceitável é o aluno não pagar por ele.
		 */
		if (variationCount > 1 && !pipelineEntregaVariacoes(doFluxo)) {
			console.error(
				`[tool-run] ${key}: return_variations pede ${variationCount}, mas nenhum bloco do fluxo '${flow ?? 'padrão'}' sabe gerar variações. Corrija a definition.`,
			);
			return recusar(
				409,
				'Esta ferramenta ainda não entrega mais de uma variação por vez. Escolha 1 e tente de novo — nada foi cobrado.',
			);
		}

		// Override per-tool do modelo + system prompt, creations/variation_count/
		// raw_prompt, e tamanho (cliente > creation_id > banco > tool) para
		// `ai.generate_image`/`ai.image_studio`. DEPOIS do portão de propósito: o
		// `variationCount` que entra aqui é o RECONCILIADO, não o pedido.
		doc = injectModelOverrides(
			doc,
			fields,
			variationCount,
			bankImageSize(selectedBankEntry),
			clientSize,
		);

		// Falha rápida em arquivo inválido (defense-in-depth; mimetype é spoofável).
		// Valida CADA arquivo enviado CONTRA O SEU INPUT: input de imagem exige
		// mimetype de imagem; input `type:'file'` valida por extensão. Refund se já
		// houver invocação pendente, pra não deixá-la presa.
		const fileError = validateUploadedFiles(
			doc.input ?? {},
			files,
			fileMimes,
			fileNames,
		);
		if (fileError) {
			return recusar(400, fileError);
		}

		// ── executa o pipeline ──
		let output: Record<string, unknown>;
		try {
			const bag = coerceInputs(
				doc.input ?? {},
				fields,
				files,
				buildFileMeta(fileMimes, fileNames),
			);
			output = await executeTool(
				doc,
				bag,
				{
					customerId,
					authHeader,
					onProgress: res.progresso,
				},
				flow,
			);
		} catch (err) {
			if (invocationId) {
				await refundInvocation(customerId, invocationId, authHeader);
			}
			if (err instanceof ToolEngineError) {
				return res.erro(err.status, err.message);
			}
			const message = err instanceof Error ? err.message : 'Unknown error';
			return res.erro(500, message);
		}

		// ── arte licenciada: código de autenticidade ──
		//
		// A regra mora AQUI, no motor, e não num bloco do pipeline: se fosse
		// bloco, um admin editando a definition poderia removê-lo e a arte da
		// marca sairia sem código — indistinguível de uma pirata, que é
		// exatamente a falha que este produto existe para evitar.
		//
		// O gatilho é o dado, não a configuração: prompt com `feature_key` é
		// prompt licenciado.
		const featureKey = licenseFeatureKeyOf(selectedBankEntry);
		let license: IssuedArtLicense | undefined;
		if (featureKey) {
			try {
				const emitida = await emitirLicenca({
					customerId,
					featureKey,
					licensorName: licensorNameOf(selectedBankEntry),
					toolKey: key,
					// A rodada cobrada é a unidade de idempotência: reenvio devolve o
					// mesmo código em vez de emitir um segundo.
					invocationId: invocationId ?? null,
					previewUrl: firstUrlOf(output),
					promptTitle: selectedBankEntry?.title ?? null,
				});
				license = {
					code: emitida.art.code,
					featureKey: emitida.art.feature_key,
					licensorName: emitida.art.licensor_name,
					issuedAt: emitida.art.created_at,
				};
			} catch (err) {
				// NUNCA entregar arte licenciada sem código. Custa uma chamada de
				// modelo desperdiçada; entregar sem QR custaria a razão de ser do
				// produto.
				console.error('[tool-run] emissão de licença falhou:', err);
				if (invocationId) {
					await refundInvocation(customerId, invocationId, authHeader);
				}
				return res.erro(
					503,
					'Não foi possível emitir o código de autenticidade. Nada foi cobrado — tente de novo.',
				);
			}
		}

		if (invocationId) {
			await settleInvocation(customerId, invocationId, authHeader);
		}
		return res.ok({ id: crypto.randomUUID(), output, license });
	} catch (err) {
		/**
		 * ┌─ ESTORNAR PELO RECIBO, NÃO PELO PORTÃO ─────────────────────────────┐
		 * │ Este `catch` estornava por `invocationId` — que só é atribuído DEPOIS │
		 * │ do portão de billing. A carga da definition acontece ANTES dele, e    │
		 * │ `loadPublishedToolDefinition` lança `ToolDefinitionLoadError` direto  │
		 * │ para cá. Resultado medido ao vivo: `/invoke` debitou, o run tomou 404 │
		 * │ `tool_not_found`, e a invocação ficou `pending` PARA SEMPRE — não há  │
		 * │ reaper em lugar nenhum (65 invocações presas em produção, a mais      │
		 * │ antiga de junho). Numa tool de 12 voxxys isso é o pior desfecho do    │
		 * │ sistema: o aluno paga e não recebe nada.                              │
		 * │                                                                       │
		 * │ `reservado` é o recibo que o CLIENTE mandou e que este run tomou para  │
		 * │ si na trava — é a mesma prova de posse que o `recusar` já usa para     │
		 * │ estornar com segurança. Um id forjado ou alheio não estorna nada: o    │
		 * │ upvox só transiciona `pending → refunded` para o dono da invocação.    │
		 * │ E estornar um recibo já liquidado é inofensivo (o upvox responde       │
		 * │ conflito e `refundInvocation` engole), então a ordem `invocationId ??  │
		 * │ reservado` nunca estorna duas vezes.                                   │
		 * └───────────────────────────────────────────────────────────────────────┘
		 */
		const paraEstornar = invocationId ?? reservado;
		if (paraEstornar && customerId) {
			await refundInvocation(customerId, paraEstornar, authHeader);
		}
		if (err instanceof ToolDefinitionLoadError) {
			return res.erro(err.status, err.message);
		}
		/**
		 * `ToolEngineError` carrega o STATUS que o erro merece — e sem este ramo
		 * ele caía no 500 abaixo. Medido: `creation_id` ausente (um 400 puro,
		 * "Escolha um tipo de criação.") saía como **HTTP 500** com a mensagem de
		 * usuário dentro. Erro de cliente vestido de falha de servidor é o pior
		 * dos dois mundos: o front não sabe tratar e o monitoramento acorda gente
		 * à toa.
		 */
		if (err instanceof ToolEngineError) {
			return res.erro(err.status, err.message);
		}
		const message = err instanceof Error ? err.message : 'Unknown error';
		return res.erro(500, message);
	} finally {
		// O recibo volta SEMPRE — inclusive quando o run explode no meio. Sem
		// isto, um erro deixaria o `invocation_id` travado até o processo cair,
		// e o aluno não conseguiria nem repetir a geração que ele já pagou.
		if (reservado) liberarInvocacao(reservado);
	}
}

/**
 * `POST /api/tool-run/:key` — resposta única, como sempre foi.
 */
export const toolRunController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) =>
	executarRun(request, {
		erro: (status, message) => reply.status(status).send({ message }),
		ok: (payload) => reply.status(201).send(payload),
	});

/**
 * `POST /api/tool-run/:key/stream` — o MESMO run, transmitido ao vivo.
 *
 * Existe porque um time de agentes leva de 20 s a 2 min, e uma tela parada
 * nesse tempo é indistinguível de travada. Os eventos vêm dos blocos, via
 * `ctx.onProgress`, e o motor carimba de qual nó saíram.
 *
 * O encanamento SSE é o mesmo já provado em `controllers/tool-agent.ts`:
 * `reply.hijack()` + `writeHead` + um `send` que ENGOLE erro de socket morto.
 * Engolir é deliberado: o aluno já pagou, o bloco grava o resultado antes de
 * responder, e derrubar o run porque o cliente fechou a aba jogaria fora um
 * trabalho cobrado para economizar centavos.
 */
export const toolRunStreamController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	reply.hijack();
	const raw = reply.raw;
	raw.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	});
	const send = (event: string, data: unknown) => {
		if (raw.writableEnded) return;
		try {
			raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
		} catch {
			// socket caiu no meio do run — ignora; o finally encerra.
		}
	};

	try {
		await executarRun(request, {
			erro: (status, message) => send('erro', { status, message }),
			ok: (payload) => send('done', payload),
			progresso: (ev) => send('progresso', ev),
		});
	} catch (err) {
		console.error('[tool-run/stream] erro:', err);
		send('erro', {
			status: 500,
			message: err instanceof Error ? err.message : 'Unknown error',
		});
	} finally {
		if (!raw.writableEnded) raw.end();
	}
};

/** Lado máximo da imagem no preview (acelera o feedback ao vivo). */
const PREVIEW_MAX_SIDE = 900;

/**
 * Nós pulados no preview: sobem ao storage, gravam registro ou batem em IA
 * (rede/custo). O critério é EFEITO COLATERAL, não categoria — o preview é
 * gratuito e ilimitado, então tudo que deixa rastro (arquivo no Bunny, linha no
 * banco) fica de fora, e tudo que só calcula continua rodando.
 *
 * O sufixo `.persist`/`.save` cobre por convenção qualquer bloco futuro que
 * grave: um bloco novo que persista precisa nascer com esse nome (ou entrar
 * nesta lista), senão o preview passa a escrever de graça.
 *
 * Os blocos da Central de Custos ficam DE PROPÓSITO no preview: `cad.parse`,
 * `cad.metrics`, `cad.diagnose`, `cad.preview_svg` e `quote.price` são puros
 * (ou só LEEM coleção) e devolvem o SVG inline como data URL — nenhum deles
 * toca storage. É o que torna o orçamento ao vivo possível sem cobrar.
 */
/**
 * ┌─ A EXCEÇÃO POR MODO, E POR QUE ELA NÃO É UM FURO ───────────────────────┐
 * │ `ai.image_studio` é UM bloco com sete caminhos, e eles não têm o mesmo   │
 * │ custo: `variacao` e `vetorizavel` chamam o fornecedor; `ampliar` é       │
 * │ Lanczos do sharp, na nossa CPU, sem sair da máquina. Cortar o bloco      │
 * │ inteiro do preview (o que a regra por prefixo fazia) proibia de graça a  │
 * │ única operação que É de graça — e o Ajuste "Ampliar" ficaria sem rota    │
 * │ possível: cobrada não pode (é local) e grátis não existia.               │
 * │                                                                          │
 * │ A exceção é do tamanho de um furo de agulha: SÓ este bloco, SÓ nos modos │
 * │ que o catálogo (`lib/atelie/ajustes.ts`) declara como locais, e SÓ       │
 * │ quando o modo dá para ser sabido antes de rodar. Modo indecifrável       │
 * │ (referência à saída de outro nó, campo ausente) conta como pago e o nó   │
 * │ continua fora — a dúvida pende sempre para o lado de não dar de graça    │
 * │ uma chamada ao fornecedor.                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Exportada para teste: é a função que separa o que é grátis do que é pago, e
 * a ORDEM importa (a exceção precisa ser avaliada antes da regra por prefixo).
 * Uma garantia dessas exercitada só por acidente não é garantia.
 */
export function skipInPreview(
	node: { block: string; params?: Record<string, unknown> },
	fields: Record<string, string>,
): boolean {
	const block = node.block;
	if (aiRodaDeGraca(block, node.params, fields)) return false;
	return (
		block.startsWith('output.') ||
		block.startsWith('ai.') ||
		block.endsWith('.persist') ||
		block.endsWith('.save') ||
		block === 'image.upscale' ||
		// removedor híbrido pode cair na IA (Gemini) em fundo complexo — nunca no preview.
		block === 'image.removeBackground' ||
		/**
		 * O CLIPE NÃO É IA E MESMO ASSIM NÃO PODE RODAR AQUI. Ele não chama
		 * fornecedor nenhum — o que ele gasta é MÁQUINA: ~2 s de CPU e ~480 MB de
		 * pico por vídeo. Nesta rota, que não cobra e não cria invocação, isso é
		 * um `ffmpeg` de graça por clique, com teto de 2 em voo por aluno.
		 *
		 * Hoje ele já não roda por SORTE ESTRUTURAL: no Ateliê o nó de imagem que
		 * o alimenta é `ai.*`, some do pipeline antes dele, e a referência vira
		 * string literal que o Zod reprova. Sorte não é portão — qualquer
		 * definition futura que ponha o clipe depois de uma fonte de imagem local
		 * (`collection.image`, `image.input`) ganharia ffmpeg grátis.
		 */
		block === 'video.ad_clip'
	);
}

/**
 * `POST /api/tool-run/:key/preview` — preview NÃO COBRADO e sem storage, pro
 * feedback ao vivo dos sliders no estúdio (espelha o `vectorizePreviewController`).
 * Reduz a imagem (~900px), TIRA os nós de saída/IA do pipeline (nada de Bunny
 * nem Gemini de graça) e devolve só `{ preview }` (base64). Gateado pelo mesmo
 * `authenticateVectorizacao` da rota; staff pode mandar `definition` inline
 * (preview de rascunho da Fábrica).
 */
/**
 * ┌─ A TORNEIRA DO PREVIEW ─────────────────────────────────────────────────┐
 * │ `POST /api/tool-run/:key/preview` não cobra, não cria invocação e não    │
 * │ tinha limite nenhum (`grep rateLimit` no repo: zero ocorrências). Com o  │
 * │ Ajuste "Ampliar" — que roda aqui de propósito, porque é sharp local —    │
 * │ uma requisição de 200 bytes devolve uma imagem de até 24 MP em base64.   │
 * │ Medido: capinha 1080×1920 ampliada 4× = 3674×6532, **36,3 MB de resposta │
 * │ e 822 ms de CPU**, por clique, repetível à vontade.                      │
 * │                                                                          │
 * │ O teto de megapixels limita o tamanho de UMA resposta, nunca a           │
 * │ frequência. Isto limita a frequência do jeito mais barato que existe:    │
 * │ N em voo por aluno. O uso normal é sequencial (a tela faz debounce e     │
 * │ aborta o preview anterior), então 2 já é folga — e um preview recusado   │
 * │ é um quadro perdido no slider, não um erro de trabalho.                  │
 * │                                                                          │
 * │ Como a trava de recibo, isto é DESTE PROCESSO. Limite de borda           │
 * │ (rate limit no gateway) continua sendo o remédio definitivo.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const PREVIEWS_EM_VOO_POR_ALUNO = 2;
const previewsEmVoo = new Map<string, number>();

export const toolPreviewController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	const authHeader = request.headers.authorization;
	if (!customerId) {
		return reply.status(403).send({ message: 'Customer not found' });
	}
	const emVoo = previewsEmVoo.get(customerId) ?? 0;
	if (emVoo >= PREVIEWS_EM_VOO_POR_ALUNO) {
		return reply
			.status(429)
			.send({ message: 'Muitas pré-visualizações ao mesmo tempo.' });
	}
	previewsEmVoo.set(customerId, emVoo + 1);
	try {
		const { key } = request.params as ToolRunParams;

		const files: Record<string, Buffer> = {};
		const fileMimes: Record<string, string> = {};
		const fileNames: Record<string, string> = {};
		const fields: Record<string, string> = {};
		for await (const part of request.parts()) {
			if (part.type === 'file') {
				files[part.fieldname] = await part.toBuffer();
				fileMimes[part.fieldname] = part.mimetype;
				fileNames[part.fieldname] = part.filename ?? '';
			} else {
				fields[part.fieldname] = part.value as string;
			}
		}

		// definition: inline (staff) ou published por key.
		let doc: ToolDefinitionDoc;
		if (fields.definition) {
			if (!isStaffRole(request.currentRole)) {
				return reply
					.status(403)
					.send({ message: 'inline_definition_forbidden' });
			}
			try {
				doc = parseInlineToolDefinition(fields.definition);
			} catch {
				return reply.status(400).send({ message: 'definition inválida' });
			}
		} else {
			const row = await loadPublishedToolDefinition(
				key,
				customerId,
				authHeader,
			);
			doc = row.definition;
		}

		// Override per-tool do modelo + system prompt para `ai.generate_image`.
		// `variationCount = 1` fixo: o preview corta todo nó `ai.*` que chama
		// fornecedor (`skipInPreview`), então não há variação nenhuma para gerar —
		// e o preview não cobra, logo não há cobrança para reconciliar.
		doc = injectModelOverrides(doc, fields, 1);

		/**
		 * Reduz cada imagem ENVIADA (preview é rápido; não precisa da resolução
		 * cheia). Vale só para o que veio no multipart — a imagem que o
		 * `collection.image` busca na galeria chega inteira, e é isso que faz o
		 * Ajuste "Ampliar" ter sentido aqui: ampliar 2× uma miniatura de 900 px
		 * devolveria menos pixel do que o original tem, com cara de resultado.
		 */
		// Reduz cada imagem enviada (preview é rápido; não precisa da resolução cheia).
		// Só IMAGEM: um input `type:'file'` (DXF/SVG) passa intacto — mandar um DXF
		// pro sharp só queima CPU pra cair no catch e devolver o buffer original.
		const inputSpecs = doc.input ?? {};
		const small: Record<string, Buffer> = {};
		for (const [name, buf] of Object.entries(files)) {
			if (inputSpecs[name]?.type === 'file') {
				small[name] = buf;
				continue;
			}
			small[name] = await sharp(buf)
				.resize(PREVIEW_MAX_SIDE, PREVIEW_MAX_SIDE, {
					fit: 'inside',
					withoutEnlargement: true,
				})
				.png()
				.toBuffer()
				.catch(() => buf);
		}

		// Pipeline de preview: sem nós de saída/IA — do fluxo pedido.
		let escolhidos: PipelineNode[];
		try {
			escolhidos = selecionarPipeline(doc, fields.flow);
		} catch (err) {
			const message =
				err instanceof ToolEngineError ? err.message : 'fluxo inválido';
			return reply.status(400).send({ message });
		}
		const rodam = escolhidos.filter((n) => !skipInPreview(n, fields));
		if (rodam.length === 0) {
			return reply.status(200).send({ preview: null });
		}
		const previewDoc = comPipeline(doc, fields.flow, rodam);

		const bag = coerceInputs(
			doc.input ?? {},
			fields,
			small,
			buildFileMeta(fileMimes, fileNames),
		);
		const output = await executeTool(
			previewDoc,
			bag,
			{
				customerId,
				authHeader,
				// O bloco não decide se roda (quem filtrou foi o `skipInPreview`);
				// decide o quanto trabalha de graça. Ver `MAX_MP_AMPLIAR_PREVIEW`.
				preview: true,
			},
			fields.flow,
		);
		const preview =
			(output.preview as string | undefined) ??
			(output.primary as string | undefined) ??
			null;
		// A montagem 3D não é imagem e por isso viaja num campo próprio. Sai da
		// projeção `output.assembly` da definition (bloco `cad.assembly`) e é
		// devolvida como objeto — o front alimenta o `ModelViewport` com ela.
		const assembly = output.assembly ?? undefined;
		return reply.status(200).send({ preview, assembly });
	} catch (err) {
		if (err instanceof ToolDefinitionLoadError) {
			return reply.status(err.status).send({ message: err.message });
		}
		if (err instanceof ToolEngineError) {
			return reply.status(err.status).send({ message: err.message });
		}
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	} finally {
		const n = (previewsEmVoo.get(customerId) ?? 1) - 1;
		if (n <= 0) previewsEmVoo.delete(customerId);
		else previewsEmVoo.set(customerId, n);
	}
};
