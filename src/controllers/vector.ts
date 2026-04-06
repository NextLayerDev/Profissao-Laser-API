import type { FastifyReply, FastifyRequest } from 'fastify';
import { vectorService } from '../services/vector.js';
import {
	createVectorSchema,
	listVectorsQuery,
	updateVectorSchema,
} from '../types/vector.js';

export const listVectorsController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const query = listVectorsQuery.parse(request.query);
	const customerId = request.currentCustomer?.id ?? query.customerId;

	if (!customerId) {
		return reply.status(400).send({ message: 'customerId is required' });
	}

	const { data: result, error } = await vectorService.listVectors(
		customerId,
		query,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(result);
};

export const getVectorController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id ?? null;
	const { data: vector, error } = await vectorService.getVector(
		request.params.id,
		customerId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Vector not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.send(vector);
};

export const createVectorController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const body = createVectorSchema.parse(request.body);
	const customerId = request.currentCustomer?.id ?? body.customerId;

	if (!customerId) {
		return reply.status(400).send({ message: 'customerId is required' });
	}

	const { data: vector, error } = await vectorService.createVector(customerId, {
		svgContent: body.svgContent,
		originalName: body.originalName,
	});
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(201).send(vector);
};

export const updateVectorController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const body = updateVectorSchema.parse(request.body);
	const customerId = request.currentCustomer?.id ?? null;
	const { data: vector, error } = await vectorService.updateVector(
		request.params.id,
		customerId,
		body,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status =
			message === 'Vector not found'
				? 404
				: message === 'Unauthorized'
					? 403
					: 500;
		return reply.status(status).send({ message });
	}
	return reply.send(vector);
};

export const deleteVectorController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id ?? null;
	const { error } = await vectorService.deleteVector(
		request.params.id,
		customerId,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status =
			message === 'Vector not found'
				? 404
				: message === 'Unauthorized'
					? 403
					: 500;
		return reply.status(status).send({ message });
	}
	return reply.status(204).send();
};
