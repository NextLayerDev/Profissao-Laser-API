import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { isStaffRole } from '../lib/external-auth.js';
import { IMAGE_MODELS_CATALOG } from '../lib/image-models-catalog.js';
import { TEXT_MODELS_CATALOG } from '../lib/text-models-catalog.js';
import {
	resolveCreation,
	resolveVariationCount,
} from '../lib/tool-creations.js';
import {
	type InputSpec,
	loadPublishedToolDefinition,
	parseInlineToolDefinition,
	type ToolDefinitionDoc,
	ToolDefinitionLoadError,
} from '../lib/tool-definitions.js';
import {
	coerceInputs,
	executeTool,
	ToolEngineError,
} from '../lib/tool-engine.js';
import {
	refundInvocation,
	resolveToolBilling,
	settleInvocation,
} from '../lib/upvox-tools.js';
import { imageSizePresetRepository } from '../repositories/image-size-preset.js';
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
		return (entry.data ?? {})[path.slice('data.'.length)];
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
 * Injeta overrides per-tool nos `params` dos nós de IA do pipeline:
 *   - `ai.generate_image` / `ai.image_studio`
 *                          ← `definition.model` / `system_prompt` / `image_*`
 *                          ← `definition.creations[creation_id]` (Passo 1)
 *                          ← `definition.return_variations` via `variation_count`
 *                          ← `definition.raw_prompt` (sem intermediação)
 *   - `ai.text`           ← `definition.text_model` / `text_system_prompt`
 *
 * `fields` carrega `creation_id` e `variation_count` (multipart strings do
 * request). A validação aqui é ANTES do gate de billing → erro 400 rejeita sem
 * cobrar (sem refund necessário).
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

	// ── return_variations (Passo 3): valida variation_count contra o allowlist.
	// Default = 1º elemento; sem return_variations = [1]. ──
	const allowedVariations = doc.return_variations ?? [1];
	const variationCount = resolveVariationCount(
		fields.variation_count,
		allowedVariations,
	);

	const useRawPrompt = !!doc.raw_prompt;

	const hasImageOverride =
		!!toolModel ||
		!!toolSystemPrompt ||
		hasSize ||
		useRawPrompt ||
		clientNative;
	const hasTextOverride = !!toolTextModel || !!toolTextSystemPrompt;
	if (
		!hasImageOverride &&
		!hasTextOverride &&
		variationCount <= 1 &&
		creations.length === 0
	) {
		return doc;
	}

	return {
		...doc,
		pipeline: (doc.pipeline ?? []).map((n) => {
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
		}),
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
export const toolRunController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	const authHeader = request.headers.authorization;
	let invocationId: string | null = null;

	try {
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
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

		// ── definition: inline draft (preview de staff) OU published por key ──
		const isStaff = isStaffRole(request.currentRole);
		let doc: ToolDefinitionDoc;
		let runtime = 'blocks_v1';
		let billed = true;

		if (fields.definition) {
			// Preview de rascunho: só staff, e NÃO cobra (sem invocation).
			if (!isStaff) {
				return reply
					.status(403)
					.send({ message: 'inline_definition_forbidden' });
			}
			try {
				// Valida a forma da definition inline (JSON + estrutura) antes de rodar.
				doc = parseInlineToolDefinition(fields.definition);
			} catch {
				return reply.status(400).send({ message: 'definition inválida' });
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
		}

		if (runtime !== 'blocks_v1') {
			return reply.status(400).send({
				message: `engine_runtime '${runtime}' não suportado (MVP: blocks_v1)`,
			});
		}

		// ── banco do admin (opcional): injeta o registro escolhido nos inputs ──
		const bank = doc.bank;
		let selectedBankEntry: ToolBankEntry | undefined;
		if (bank?.enabled) {
			const bankEntryId = fields.bank_entry_id;
			if (!bankEntryId) {
				// Staff em preview (billed=false) pode testar sem escolher um item.
				if (billed) {
					return reply
						.status(400)
						.send({ message: 'Escolha um item do banco.' });
				}
			} else {
				const entry = await toolBankRepository.findById(bankEntryId, key, {
					activeOnly: !isStaff,
				});
				if (!entry) {
					return reply.status(400).send({ message: 'Item do banco inválido.' });
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
				return reply
					.status(400)
					.send({ message: 'image_size inválido (JSON).' });
			}
			const parsed = bankImageSizeSchema.safeParse(parsedSize);
			if (!parsed.success) {
				return reply.status(400).send({ message: 'image_size inválido.' });
			}
			try {
				clientSize = await resolveImageSizePx(parsed.data, async (id) =>
					imageSizePresetRepository.findById(id),
				);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : 'image_size inválido.';
				return reply.status(400).send({ message });
			}
		}

		// Override per-tool do modelo + system prompt, creations/variation_count/
		// raw_prompt, e tamanho (cliente > creation_id > banco > tool) para
		// `ai.generate_image`/`ai.image_studio`.
		doc = injectModelOverrides(
			doc,
			fields,
			bankImageSize(selectedBankEntry),
			clientSize,
		);

		// ── billing (autoritativo no upvox) ──
		if (billed) {
			const gate = await resolveToolBilling(
				customerId,
				key,
				fields.invocation_id ?? null,
				authHeader,
			);
			if (gate.mode === 'reject') {
				return reply.status(gate.status).send({ message: gate.message });
			}
			invocationId = gate.mode === 'paid' ? gate.invocationId : null;
		}

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
			if (invocationId) {
				await refundInvocation(customerId, invocationId, authHeader);
			}
			return reply.status(400).send({ message: fileError });
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
			output = await executeTool(doc, bag, { customerId, authHeader });
		} catch (err) {
			if (invocationId) {
				await refundInvocation(customerId, invocationId, authHeader);
			}
			if (err instanceof ToolEngineError) {
				return reply.status(err.status).send({ message: err.message });
			}
			const message = err instanceof Error ? err.message : 'Unknown error';
			return reply.status(500).send({ message });
		}

		if (invocationId) {
			await settleInvocation(customerId, invocationId, authHeader);
		}
		return reply.status(201).send({ id: crypto.randomUUID(), output });
	} catch (err) {
		if (invocationId && customerId) {
			await refundInvocation(customerId, invocationId, authHeader);
		}
		if (err instanceof ToolDefinitionLoadError) {
			return reply.status(err.status).send({ message: err.message });
		}
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
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
function skipInPreview(block: string): boolean {
	return (
		block.startsWith('output.') ||
		block.startsWith('ai.') ||
		block.endsWith('.persist') ||
		block.endsWith('.save') ||
		block === 'image.upscale' ||
		// removedor híbrido pode cair na IA (Gemini) em fundo complexo — nunca no preview.
		block === 'image.removeBackground'
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
export const toolPreviewController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	const authHeader = request.headers.authorization;
	if (!customerId) {
		return reply.status(403).send({ message: 'Customer not found' });
	}
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
		doc = injectModelOverrides(doc, fields);

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

		// Pipeline de preview: sem nós de saída/IA.
		const previewDoc: ToolDefinitionDoc = {
			...doc,
			pipeline: (doc.pipeline ?? []).filter((n) => !skipInPreview(n.block)),
		};
		if ((previewDoc.pipeline ?? []).length === 0) {
			return reply.status(200).send({ preview: null });
		}

		const bag = coerceInputs(
			doc.input ?? {},
			fields,
			small,
			buildFileMeta(fileMimes, fileNames),
		);
		const output = await executeTool(previewDoc, bag, {
			customerId,
			authHeader,
		});
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
	}
};
