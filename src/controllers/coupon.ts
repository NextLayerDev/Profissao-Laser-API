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

		const coupon = await productService.createCoupon(data);
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
	try {
		const { product_id } = request.params;
		const coupons = await productService.listCouponsByProduct(product_id);
		return reply.send(coupons);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const deleteCouponController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const { id } = request.params;
		const deleted = await productService.deleteCoupon(id);
		return reply.send(deleted);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
