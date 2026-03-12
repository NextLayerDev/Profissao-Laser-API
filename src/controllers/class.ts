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
	try {
		const classes = await classService.listClasses();
		console.log(classes);
		return reply.send(classes);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getClassByIdController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const cls = await classService.getClassById(request.params.id);
		return reply.send(cls);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Class not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const createClassController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createClassSchema.parse(request.body);
		const cls = await classService.createClass(data);
		return reply.status(201).send(cls);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const updateClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updateClassSchema.parse(request.body);
		const cls = await classService.updateClass(request.params.id, data);
		return reply.send(cls);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Class not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const deleteClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		await classService.deleteClass(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Class not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const addProductToClassController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { productId } = addProductToClassSchema.parse(request.body);
		await classService.addProduct(request.params.id, productId);
		return reply.status(201).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status =
			message === 'Class not found' || message === 'Product not found'
				? 404
				: 500;
		return reply.status(status).send({ message });
	}
};

export const removeProductFromClassController = async (
	request: FastifyRequest<{ Params: { id: string; productId: string } }>,
	reply: FastifyReply,
) => {
	try {
		await classService.removeProduct(
			request.params.id,
			request.params.productId,
		);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Product not in class' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};
