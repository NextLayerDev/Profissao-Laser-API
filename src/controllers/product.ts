import type { FastifyReply, FastifyRequest } from 'fastify';
import { productService } from '../services/product.js';

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
