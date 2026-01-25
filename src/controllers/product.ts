import type { FastifyReply, FastifyRequest } from 'fastify';
import { productService } from '../services/product.js';
import { createProductSchema } from '../types/product.js';

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
		const { name, description, prices } = createProductSchema.parse(
			request.body,
		);

		const product = await productService.createProduct({
			name,
			description,
			prices,
		});

		return reply.status(201).send(product);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getProductsCatalogController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const products = await productService.getProductsCatalog();

		return reply.send(products);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
