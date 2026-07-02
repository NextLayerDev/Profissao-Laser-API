import type { FastifyReply, FastifyRequest } from 'fastify';
import { omniAgentRepository } from '../../repositories/omni-agent.js';
import { omniConfigRepository } from '../../repositories/omni-config.js';
import { omniKbRepository } from '../../repositories/omni-kb.js';
import { OmniKbError, omniKbService } from '../../services/omni/kb.js';
import type { OmniBusinessConfigFields } from '../../services/omni/prompts.js';
import { searchKnowledge } from '../../services/omni/rag.js';
import { resolveInstanceAccess } from './access.js';

/** Agentes, config do negócio e base de conhecimento (RAG). */

const CONFIG_STRING_FIELDS: Array<keyof OmniBusinessConfigFields> = [
	'company_description',
	'product_categories',
	'greeting_message',
	'payment_method',
	'payment_terms',
	'local_pickup_city',
	'delivery_policy',
	'business_location',
	'business_hours',
	'marketplace_url',
	'exchange_policy',
	'accepted_formats',
	'human_transfer_priority',
	'tone_of_voice',
];

const KB_MIMES = new Set([
	'application/pdf',
	'text/plain',
	'text/markdown',
	'text/csv',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/msword',
]);

// ── Agentes ──────────────────────────────────────────────────────────────────

export async function listAgentsController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as { id: string };
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	return reply.send(await omniAgentRepository.listByInstance(id));
}

export async function createAgentController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as { id: string };
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	const body = (request.body ?? {}) as Record<string, unknown>;
	const name = String(body.name ?? '').trim();
	if (!name) return reply.status(400).send({ message: 'name obrigatório' });
	const slug =
		String(body.slug ?? '')
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9_]/g, '_')
			.replace(/_+/g, '_')
			.replace(/^_|_$/g, '') ||
		name
			.toLowerCase()
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_|_$/g, '');
	const role = body.role === 'router' ? 'router' : 'specialist';
	try {
		const agent = await omniAgentRepository.create({
			instance_id: id,
			name,
			slug,
			role,
			system_prompt: String(body.system_prompt ?? ''),
			tool_description: String(body.tool_description ?? ''),
			model: String(body.model ?? 'google/gemini-2.5-flash'),
			temperature: Number(body.temperature ?? 0.4),
			position: Number(body.position ?? 0),
			enabled: body.enabled !== false,
		});
		return reply.status(201).send(agent);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		if (message.includes('duplicate') || message.includes('unique')) {
			return reply.status(409).send({
				message:
					role === 'router'
						? 'Já existe um agente roteador nesta instância.'
						: 'Já existe um agente com esse slug.',
			});
		}
		throw err;
	}
}

export async function updateAgentController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { agentId } = request.params as { agentId: string };
	const agent = await omniAgentRepository.findById(agentId);
	if (!agent)
		return reply.status(404).send({ message: 'Agente não encontrado' });
	const instance = await resolveInstanceAccess(
		request,
		reply,
		agent.instance_id,
	);
	if (!instance) return;
	const body = (request.body ?? {}) as Record<string, unknown>;
	const patch: Record<string, unknown> = {};
	for (const key of [
		'name',
		'slug',
		'system_prompt',
		'tool_description',
		'model',
	] as const) {
		if (typeof body[key] === 'string') patch[key] = body[key];
	}
	if (typeof body.temperature === 'number') {
		patch.temperature = Math.min(Math.max(body.temperature, 0), 1);
	}
	if (typeof body.position === 'number') patch.position = body.position;
	if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
	const updated = await omniAgentRepository.update(agentId, patch);
	return reply.send(updated);
}

export async function deleteAgentController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { agentId } = request.params as { agentId: string };
	const agent = await omniAgentRepository.findById(agentId);
	if (!agent)
		return reply.status(404).send({ message: 'Agente não encontrado' });
	const instance = await resolveInstanceAccess(
		request,
		reply,
		agent.instance_id,
	);
	if (!instance) return;
	if (agent.role === 'router') {
		const specialists = await omniAgentRepository.countSpecialists(
			agent.instance_id,
		);
		if (specialists > 0) {
			return reply.status(400).send({
				message:
					'Não dá pra remover o roteador enquanto houver especialistas. Remova-os primeiro.',
			});
		}
	}
	await omniAgentRepository.remove(agentId);
	return reply.status(204).send();
}

// ── Config do negócio ────────────────────────────────────────────────────────

export async function getBusinessConfigController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as { id: string };
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	const config = await omniConfigRepository.get(id);
	return reply.send(config ?? {});
}

export async function putBusinessConfigController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as { id: string };
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	const body = (request.body ?? {}) as Record<string, unknown>;
	const config: OmniBusinessConfigFields = {};
	for (const key of CONFIG_STRING_FIELDS) {
		if (typeof body[key] === 'string') {
			config[key] = (body[key] as string).slice(0, 4000);
		}
	}
	if (typeof body.issues_invoice === 'boolean') {
		config.issues_invoice = body.issues_invoice;
	}
	if (typeof body.engraving_included === 'boolean') {
		config.engraving_included = body.engraving_included;
	}
	const saved = await omniConfigRepository.upsert(id, config);
	return reply.send(saved);
}

// ── Base de conhecimento ─────────────────────────────────────────────────────

export async function listKbFilesController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as { id: string };
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	return reply.send(await omniKbRepository.listFiles(id));
}

export async function uploadKbFileController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as { id: string };
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	if (!request.isMultipart()) {
		return reply
			.status(400)
			.send({ message: 'Envie multipart com o arquivo.' });
	}
	let file: { buffer: Buffer; mime: string; name: string } | null = null;
	for await (const part of request.parts()) {
		if (part.type === 'file') {
			const buffer = await part.toBuffer();
			file = { buffer, mime: part.mimetype, name: part.filename ?? 'arquivo' };
		}
	}
	if (!file) return reply.status(400).send({ message: 'Arquivo ausente.' });
	const mime = file.mime.toLowerCase();
	const byExt = file.name.toLowerCase();
	const allowed =
		KB_MIMES.has(mime) ||
		byExt.endsWith('.md') ||
		byExt.endsWith('.txt') ||
		byExt.endsWith('.pdf') ||
		byExt.endsWith('.docx');
	if (!allowed) {
		return reply
			.status(400)
			.send({ message: 'Formato não suportado (PDF, DOCX, TXT ou MD).' });
	}
	if (file.buffer.length > 20 * 1024 * 1024) {
		return reply.status(400).send({ message: 'Arquivo acima de 20MB.' });
	}
	try {
		const row = await omniKbService.ingest(id, file.buffer, file.name, mime);
		return reply.status(202).send(row);
	} catch (err) {
		if (err instanceof OmniKbError) {
			return reply.status(err.status).send({ message: err.message });
		}
		throw err;
	}
}

export async function deleteKbFileController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { fileId } = request.params as { fileId: string };
	const file = await omniKbRepository.findFileById(fileId);
	if (!file)
		return reply.status(404).send({ message: 'Arquivo não encontrado' });
	const instance = await resolveInstanceAccess(
		request,
		reply,
		file.instance_id,
	);
	if (!instance) return;
	await omniKbService.remove(fileId);
	return reply.status(204).send();
}

export async function searchKbController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as { id: string };
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	const body = (request.body ?? {}) as { query?: string };
	const query = body.query?.trim();
	if (!query) return reply.status(400).send({ message: 'query obrigatória' });
	const result = await searchKnowledge(id, query, 5);
	return reply.send({
		result,
		chunks: result ? result.split('\n\n---\n\n') : [],
	});
}
