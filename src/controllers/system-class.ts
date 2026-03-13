import type { FastifyReply, FastifyRequest } from 'fastify';
import { systemClassService } from '../services/system-class.js';
import {
	addClassToSystemClassSchema,
	addProductToSystemClassSchema,
	createSystemClassSchema,
	updateSystemClassSchema,
} from '../types/system-class.js';

export const listSystemClassesController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const systemClasses = await systemClassService.listSystemClasses();
		return reply.send(systemClasses);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getSystemClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const sc = await systemClassService.getSystemClassById(request.params.id);
		return reply.send(sc);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'System class not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const createSystemClassController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createSystemClassSchema.parse(request.body);
		const sc = await systemClassService.createSystemClass(data);
		return reply.status(201).send(sc);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const updateSystemClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updateSystemClassSchema.parse(request.body);
		const sc = await systemClassService.updateSystemClass(
			request.params.id,
			data,
		);
		return reply.send(sc);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'System class not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const deleteSystemClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		await systemClassService.deleteSystemClass(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'System class not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const addProductToSystemClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { productId } = addProductToSystemClassSchema.parse(request.body);
		await systemClassService.addProduct(request.params.id, productId);
		return reply.status(201).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status =
			message === 'System class not found' || message === 'Product not found'
				? 404
				: 500;
		return reply.status(status).send({ message });
	}
};

export const removeProductFromSystemClassController = async (
	request: FastifyRequest<{ Params: { id: string; productId: string } }>,
	reply: FastifyReply,
) => {
	try {
		await systemClassService.removeProduct(
			request.params.id,
			request.params.productId,
		);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Product not in system class' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const addClassToSystemClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { classId } = addClassToSystemClassSchema.parse(request.body);
		await systemClassService.addClass(request.params.id, classId);
		return reply.status(201).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status =
			message === 'System class not found' || message === 'Class not found'
				? 404
				: 500;
		return reply.status(status).send({ message });
	}
};

export const removeClassFromSystemClassController = async (
	request: FastifyRequest<{ Params: { id: string; classId: string } }>,
	reply: FastifyReply,
) => {
	try {
		await systemClassService.removeClass(
			request.params.id,
			request.params.classId,
		);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Class not in system class' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};
