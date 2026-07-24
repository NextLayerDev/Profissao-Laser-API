import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { isStaffRole } from '../lib/external-auth.js';
import { IMAGE_MODELS_CATALOG } from '../lib/image-models-catalog.js';
import {
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
import { toolBankRepository } from '../repositories/tool-bank.js';
import { registerCoreBlocks } from '../tool-blocks/index.js';
import type { ToolBankEntry } from '../types/tool-bank.js';

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

interface ToolRunParams {
	key: string;
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
 * Injeta overrides per-tool (`definition.model`, `definition.system_prompt`)
 * nos `params` dos nós `ai.generate_image` do pipeline. Fast-path: se nenhum
 * override estiver setado, devolve o doc intacto (zero impacto retrocompat).
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
 * `sizeOverride` (tamanho definido no item do banco escolhido, `data.image_size_px`)
 * vence o tamanho da tool (`doc.image_width/height`) quando presente — cada
 * "Prompt Mágico" pode ter seu próprio formato de saída.
 */
function injectAiGenerateImageOverrides(
	doc: ToolDefinitionDoc,
	sizeOverride?: { width: number; height: number },
): ToolDefinitionDoc {
	const catalogIds = new Set(IMAGE_MODELS_CATALOG.map((m) => m.id));
	let toolModel = doc.model;
	if (toolModel && !catalogIds.has(toolModel)) {
		console.warn(
			`[tool-run] doc.model '${toolModel}' não está no catálogo curado — caindo no default. Atualize o IMAGE_MODELS_CATALOG ou remova o override.`,
		);
		toolModel = undefined;
	}
	const toolSystemPrompt = doc.system_prompt;
	const w = sizeOverride?.width ?? doc.image_width;
	const h = sizeOverride?.height ?? doc.image_height;
	const hasSize =
		typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0;
	if (!toolModel && !toolSystemPrompt && !hasSize) return doc;
	return {
		...doc,
		pipeline: (doc.pipeline ?? []).map((n) =>
			n.block !== 'ai.generate_image'
				? n
				: {
						...n,
						params: {
							...(n.params ?? {}),
							...(toolModel ? { model: toolModel } : {}),
							...(toolSystemPrompt ? { system_prompt: toolSystemPrompt } : {}),
							...(hasSize ? { width: w, height: h } : {}),
						},
					},
		),
	};
}

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
		// tipo roda por arquivo (`fileMimes`).
		const files: Record<string, Buffer> = {};
		const fileMimes: Record<string, string> = {};
		const fields: Record<string, string> = {};
		for await (const part of request.parts()) {
			if (part.type === 'file') {
				files[part.fieldname] = await part.toBuffer();
				fileMimes[part.fieldname] = part.mimetype;
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

		// Override per-tool do modelo + system prompt, e tamanho (item do banco
		// vence a tool) para `ai.generate_image`.
		doc = injectAiGenerateImageOverrides(doc, bankImageSize(selectedBankEntry));

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

		// Falha rápida em tipo não-imagem (defense-in-depth; mimetype é spoofável).
		// Valida CADA arquivo enviado. Refund se já houver invocação pendente, pra
		// não deixá-la presa.
		const badFile = Object.values(fileMimes).some(
			(m) => !ALLOWED_IMAGE_MIME.has(m),
		);
		if (badFile) {
			if (invocationId) {
				await refundInvocation(customerId, invocationId, authHeader);
			}
			return reply.status(400).send({
				message: 'Tipo de arquivo não suportado (envie PNG/JPG/WEBP).',
			});
		}

		// ── executa o pipeline ──
		let output: Record<string, unknown>;
		try {
			const bag = coerceInputs(doc.input ?? {}, fields, files);
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

/** Nós pulados no preview: sobem ao storage ou batem em IA (rede/custo). */
function skipInPreview(block: string): boolean {
	return (
		block.startsWith('output.') ||
		block.startsWith('ai.') ||
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
		const fields: Record<string, string> = {};
		for await (const part of request.parts()) {
			if (part.type === 'file') {
				files[part.fieldname] = await part.toBuffer();
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
		doc = injectAiGenerateImageOverrides(doc);

		// Reduz cada imagem enviada (preview é rápido; não precisa da resolução cheia).
		const small: Record<string, Buffer> = {};
		for (const [name, buf] of Object.entries(files)) {
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

		const bag = coerceInputs(doc.input ?? {}, fields, small);
		const output = await executeTool(previewDoc, bag, {
			customerId,
			authHeader,
		});
		const preview =
			(output.preview as string | undefined) ??
			(output.primary as string | undefined) ??
			null;
		return reply.status(200).send({ preview });
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
