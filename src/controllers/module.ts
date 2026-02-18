import type { FastifyReply, FastifyRequest } from 'fastify';
import { moduleService } from '../services/module.js';
import { createModuleSchema, updateModuleSchema } from '../types/module.js';

export const createModuleController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createModuleSchema.parse(request.body);
		const module = await moduleService.create(data);
		return reply.status(201).send(module);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const updateModuleController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updateModuleSchema.parse(request.body);
		const module = await moduleService.update(request.params.id, data);
		return reply.send(module);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Module not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const deleteModuleController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		await moduleService.delete(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Module not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const listModulesController = async (
	request: FastifyRequest<{ Params: { productId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const modules = await moduleService.listByProduct(request.params.productId);
		return reply.send(modules);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
