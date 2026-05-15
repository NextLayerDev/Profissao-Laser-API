import type { FastifyReply, FastifyRequest } from 'fastify';
import { vectorizeHelpService } from '../services/vectorize-help.js';
import {
	createVectorizeHelpSchema,
	reorderVectorizeHelpSchema,
	updateVectorizeHelpSchema,
} from '../types/vectorize-help.js';

function statusFor(message: string): number {
	if (message === 'Vectorize help not found') return 404;
	return 500;
}

// ── List todos (admin) ──────────────────────────────────────────────────────
export const listVectorizeHelpController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const items = await vectorizeHelpService.listAll();
		return reply.send(items);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

// ── List ativos (customer) ──────────────────────────────────────────────────
export const listActiveVectorizeHelpController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const items = await vectorizeHelpService.listActive();
		return reply.send(items);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

// ── Get by id (admin) ───────────────────────────────────────────────────────
export const getVectorizeHelpController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const item = await vectorizeHelpService.findById(request.params.id);
		return reply.send(item);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

// ── Create (admin) ──────────────────────────────────────────────────────────
export const createVectorizeHelpController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createVectorizeHelpSchema.parse(request.body);
		const item = await vectorizeHelpService.create(data);
		return reply.status(201).send(item);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

// ── Update (admin) ──────────────────────────────────────────────────────────
export const updateVectorizeHelpController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updateVectorizeHelpSchema.parse(request.body);
		const item = await vectorizeHelpService.update(request.params.id, data);
		return reply.send(item);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

// ── Delete (admin) ──────────────────────────────────────────────────────────
export const deleteVectorizeHelpController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		await vectorizeHelpService.delete(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

// ── Reorder (admin) ─────────────────────────────────────────────────────────
export const reorderVectorizeHelpController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const { ids } = reorderVectorizeHelpSchema.parse(request.body);
		const items = await vectorizeHelpService.reorder(ids);
		return reply.send(items);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};
