import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isStaffRole } from '../lib/external-auth.js';
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

/** Troca `{var}` pelos campos do cliente; deixa o placeholder se faltar a var. */
function substituteVars(template: string, ctx: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (_m, k: string) =>
		ctx[k] !== undefined ? ctx[k] : `{${k}}`,
	);
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

		// ── multipart: 1 arquivo (opcional) + campos string ──
		let fileBuffer: Buffer | null = null;
		let mimetype = 'application/octet-stream';
		const fields: Record<string, string> = {};
		for await (const part of request.parts()) {
			if (part.type === 'file') {
				fileBuffer = await part.toBuffer();
				mimetype = part.mimetype;
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
		// Refund se já houver invocação pendente, pra não deixá-la presa.
		if (fileBuffer && !ALLOWED_IMAGE_MIME.has(mimetype)) {
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
			const bag = coerceInputs(doc.input ?? {}, fields, fileBuffer);
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
