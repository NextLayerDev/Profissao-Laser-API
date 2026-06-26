import type { FastifyReply, FastifyRequest } from 'fastify';
import { fornecedorService } from '../services/fornecedor.js';
import {
	createFornecedorSchema,
	updateFornecedorSchema,
} from '../types/fornecedor.js';

export const listFornecedoresController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		return reply.send(await fornecedorService.list());
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createFornecedorController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const parsed = createFornecedorSchema.parse(request.body);
		const created = await fornecedorService.create(parsed);
		return reply.status(201).send(created);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateFornecedorController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const parsed = updateFornecedorSchema.parse(request.body);
		const updated = await fornecedorService.update(request.params.id, parsed);
		return reply.send(updated);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Fornecedor not found' ? 404 : 400;
		return reply.status(status).send({ message });
	}
};

export const deleteFornecedorController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		await fornecedorService.delete(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Fornecedor not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};
