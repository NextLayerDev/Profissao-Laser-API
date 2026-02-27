import type { FastifyReply, FastifyRequest } from 'fastify';
import { productService } from '../services/product.js';
import {
	createProductSchema,
	updateProductStatusSchema,
} from '../types/product.js';

export const getProductsController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const products = await productService.listProducts();
		return reply.send(products);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createProductController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createProductSchema.parse(request.body);
		const product = await productService.createProduct(data);
		return reply.status(201).send(product);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const updateProductStatusController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { active } = updateProductStatusSchema.parse(request.body);
		const product = await productService.updateProductStatus(
			request.params.id,
			active,
		);
		return reply.send(product);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Product not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const deleteProductController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		await productService.deleteProduct(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Product not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};
