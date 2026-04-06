import type { FastifyReply, FastifyRequest } from 'fastify';
import { productService } from '../services/product.js';
import { createCouponSchema } from '../types/coupon.js';

export const createCouponController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const data = createCouponSchema.parse(request.body);

		if (!data.percent_off && !data.amount_off) {
			return reply
				.status(400)
				.send({ message: 'percent_off or amount_off is required.' });
		}

		const { data: coupon, error } = await productService.createCoupon(data);
		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(500).send({ message });
		}
		return reply.status(201).send(coupon);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getCouponsByProductController = async (
	request: FastifyRequest<{ Params: { product_id: string } }>,
	reply: FastifyReply,
) => {
	const { product_id } = request.params;
	const { data: coupons, error } =
		await productService.listCouponsByProduct(product_id);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(coupons);
};

export const deleteCouponController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { id } = request.params;
	const { data: deleted, error } = await productService.deleteCoupon(id);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(deleted);
};
