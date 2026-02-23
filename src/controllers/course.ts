import type { FastifyReply, FastifyRequest } from 'fastify';
import { productService } from '../services/product.js';

export const getCourseContentController = async (
	request: FastifyRequest<{ Params: { slug: string } }>,
	reply: FastifyReply,
) => {
	try {
		const course = await productService.getCourseContent(request.params.slug);

		return reply.send(course);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Product not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};
