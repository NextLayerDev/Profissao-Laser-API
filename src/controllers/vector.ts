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
	try {
		const query = listVectorsQuery.parse(request.query);
		const customerId = request.currentCustomer?.id ?? query.customerId;

		if (!customerId) {
			return reply.status(400).send({ message: 'customerId is required' });
		}

		const result = await vectorService.listVectors(customerId, query);
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getVectorController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id ?? null;
		const vector = await vectorService.getVector(request.params.id, customerId);
		return reply.send(vector);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Vector not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const createVectorController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const body = createVectorSchema.parse(request.body);
		const customerId = request.currentCustomer?.id ?? body.customerId;

		if (!customerId) {
			return reply.status(400).send({ message: 'customerId is required' });
		}

		const vector = await vectorService.createVector(customerId, {
			svgContent: body.svgContent,
			originalName: body.originalName,
		});
		return reply.status(201).send(vector);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const updateVectorController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const body = updateVectorSchema.parse(request.body);
		const customerId = request.currentCustomer?.id ?? null;
		const vector = await vectorService.updateVector(
			request.params.id,
			customerId,
			body,
		);
		return reply.send(vector);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status =
			message === 'Vector not found'
				? 404
				: message === 'Unauthorized'
					? 403
					: 500;
		return reply.status(status).send({ message });
	}
};

export const deleteVectorController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id ?? null;
		await vectorService.deleteVector(request.params.id, customerId);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status =
			message === 'Vector not found'
				? 404
				: message === 'Unauthorized'
					? 403
					: 500;
		return reply.status(status).send({ message });
	}
};
