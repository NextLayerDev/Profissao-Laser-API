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
	const { data: systemClasses, error } =
		await systemClassService.listSystemClasses();
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	console.log(systemClasses);
	return reply.send(systemClasses);
};

export const getSystemClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { data: sc, error } = await systemClassService.getSystemClassById(
		request.params.id,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'System class not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.send(sc);
};

export const createSystemClassController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const data = createSystemClassSchema.parse(request.body);
	const { data: sc, error } = await systemClassService.createSystemClass(data);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(201).send(sc);
};

export const updateSystemClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const data = updateSystemClassSchema.parse(request.body);
	const { data: sc, error } = await systemClassService.updateSystemClass(
		request.params.id,
		data,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'System class not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.send(sc);
};

export const deleteSystemClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { error } = await systemClassService.deleteSystemClass(
		request.params.id,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'System class not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.status(204).send();
};

export const addProductToSystemClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { productId } = addProductToSystemClassSchema.parse(request.body);
	const { error } = await systemClassService.addProduct(
		request.params.id,
		productId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status =
			message === 'System class not found' || message === 'Product not found'
				? 404
				: 500;
		return reply.status(status).send({ message });
	}
	return reply.status(201).send();
};

export const removeProductFromSystemClassController = async (
	request: FastifyRequest<{ Params: { id: string; productId: string } }>,
	reply: FastifyReply,
) => {
	const { error } = await systemClassService.removeProduct(
		request.params.id,
		request.params.productId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Product not in system class' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.status(204).send();
};

export const addClassToSystemClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { classId } = addClassToSystemClassSchema.parse(request.body);
	const { error } = await systemClassService.addClass(
		request.params.id,
		classId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status =
			message === 'System class not found' || message === 'Class not found'
				? 404
				: 500;
		return reply.status(status).send({ message });
	}
	return reply.status(201).send();
};

export const removeClassFromSystemClassController = async (
	request: FastifyRequest<{ Params: { id: string; classId: string } }>,
	reply: FastifyReply,
) => {
	const { error } = await systemClassService.removeClass(
		request.params.id,
		request.params.classId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Class not in system class' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.status(204).send();
};
