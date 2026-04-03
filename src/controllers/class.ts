import type { FastifyReply, FastifyRequest } from 'fastify';
import { classService } from '../services/class.js';
import {
	addProductToClassSchema,
	createClassSchema,
	updateClassSchema,
} from '../types/class.js';

export const getClassesController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	const { data: classes, error } = await classService.listClasses();
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	console.log(classes);
	return reply.send(classes);
};

export const getClassByIdController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { data: cls, error } = await classService.getClassById(
		request.params.id,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Class not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.send(cls);
};

export const createClassController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const data = createClassSchema.parse(request.body);
	const { data: cls, error } = await classService.createClass(data);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(201).send(cls);
};

export const updateClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const data = updateClassSchema.parse(request.body);
	const { data: cls, error } = await classService.updateClass(
		request.params.id,
		data,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Class not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.send(cls);
};

export const deleteClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { error } = await classService.deleteClass(request.params.id);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Class not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.status(204).send();
};

export const addProductToClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { productId } = addProductToClassSchema.parse(request.body);
	const { error } = await classService.addProduct(request.params.id, productId);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status =
			message === 'Class not found' || message === 'Product not found'
				? 404
				: 500;
		return reply.status(status).send({ message });
	}
	return reply.status(201).send();
};

export const removeProductFromClassController = async (
	request: FastifyRequest<{ Params: { id: string; productId: string } }>,
	reply: FastifyReply,
) => {
	const { error } = await classService.removeProduct(
		request.params.id,
		request.params.productId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Product not in class' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.status(204).send();
};
