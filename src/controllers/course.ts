import type { FastifyReply, FastifyRequest } from 'fastify';
import { productService } from '../services/product.js';

export const getCourseContentController = async (
	request: FastifyRequest<{ Params: { slug: string } }>,
	reply: FastifyReply,
) => {
	const { data: course, error } = await productService.getCourseContent(
		request.params.slug,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Product not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.send(course);
};
