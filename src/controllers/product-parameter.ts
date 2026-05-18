import type { FastifyReply, FastifyRequest } from 'fastify';
import { productParameterService } from '../services/product-parameter.js';
import {
	createProductParameterSchema,
	parameterLookupQuerySchema,
	updateProductParameterSchema,
} from '../types/product-parameter.js';

function statusFor(message: string): number {
	if (message === 'Product parameter not found') return 404;
	if (message === 'Lesson not found') return 404;
	if (message === 'Parameter not found') return 404;
	if (message === 'Machine not found') return 404;
	if (message === 'Parâmetro não encontrado') return 404;
	if (message === 'Máquina não informada') return 400;
	if (message.startsWith('Opção inválida')) return 400;
	if (message.startsWith('Informe parameterId')) return 400;
	return 500;
}

// ── List associações de um produto (admin) ─────────────────────────────────
export const listProductParametersController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const items = await productParameterService.listByProduct(
			request.params.id,
		);
		return reply.send(items);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

// ── Create associação (admin) ───────────────────────────────────────────────
export const createProductParameterController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = createProductParameterSchema.parse(request.body);
		const assoc = await productParameterService.create(
			request.params.id,
			data,
			request.currentUser?.id ?? null,
		);
		return reply.status(201).send(assoc);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

// ── Update associação (admin) ───────────────────────────────────────────────
export const updateProductParameterController = async (
	request: FastifyRequest<{ Params: { id: string; assocId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = updateProductParameterSchema.parse(request.body);
		const assoc = await productParameterService.update(
			request.params.id,
			request.params.assocId,
			data,
		);
		return reply.send(assoc);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

// ── Delete associação (admin) ───────────────────────────────────────────────
export const deleteProductParameterController = async (
	request: FastifyRequest<{ Params: { id: string; assocId: string } }>,
	reply: FastifyReply,
) => {
	try {
		await productParameterService.delete(
			request.params.id,
			request.params.assocId,
		);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

// ── Lookup (customer) — o fluxo do parâmetro ────────────────────────────────
export const parameterLookupController = async (
	request: FastifyRequest<{
		Params: { id: string };
		Querystring: {
			machineId?: string;
			powerOptionId?: string;
			lensOptionId?: string;
			softwareOptionId?: string;
			axisOptionId?: string;
			operationOptionId?: string;
		};
	}>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const query = parameterLookupQuerySchema.parse(request.query);
		const result = await productParameterService.lookup(
			request.params.id,
			customerId,
			query,
		);
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};
