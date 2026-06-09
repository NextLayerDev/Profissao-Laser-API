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
import { registerCoreBlocks } from '../tool-blocks/index.js';

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
