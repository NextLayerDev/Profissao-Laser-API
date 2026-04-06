import type { FastifyReply, FastifyRequest } from 'fastify';
import { moduleService } from '../services/module.js';
import {
	createModuleSchema,
	reorderModulesSchema,
	updateModuleSchema,
} from '../types/module.js';

export const createModuleController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const data = createModuleSchema.parse(request.body);
	const { data: module, error } = await moduleService.create(data);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(201).send(module);
};

export const updateModuleController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const data = updateModuleSchema.parse(request.body);
	const { data: module, error } = await moduleService.update(
		request.params.id,
		data,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Module not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.send(module);
};

export const deleteModuleController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { error } = await moduleService.delete(request.params.id);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Module not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.status(204).send();
};

export const listModulesController = async (
	request: FastifyRequest<{ Params: { productId: string } }>,
	reply: FastifyReply,
) => {
	const { data: modules, error } = await moduleService.listByProduct(
		request.params.productId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(modules);
};

export const reorderModulesController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const { moduleIds } = reorderModulesSchema.parse(request.body);
	const { error } = await moduleService.reorder(moduleIds);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(204).send();
};
