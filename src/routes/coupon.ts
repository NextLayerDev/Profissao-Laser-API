import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateAdmin } from '@/middleware/auth.js';
import {
	createCouponController,
	deleteCouponController,
	getCouponsByProductController,
} from '../controllers/coupon.js';
import {
	couponResponseSchema,
	couponSchema,
	createCouponSchema,
	deleteCouponResponseSchema,
} from '../types/coupon.js';
import { ErrorSchema } from '../types/error.js';

export async function couponRoute(server: FastifyInstance) {
	server.post(
		'/coupon',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Create a discount coupon for a product registered in Stripe.',
				body: createCouponSchema,
				response: {
					201: couponResponseSchema,
					400: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Coupons'],
				security: [{ bearerAuth: [] }],
			},
		},
		createCouponController,
	);

	server.get(
		'/coupons/:product_id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'List all coupons associated with a specific product.',
				params: z.object({ product_id: z.string() }),
				response: {
					200: z.array(couponSchema),
					500: ErrorSchema,
				},
				tags: ['Coupons'],
				security: [{ bearerAuth: [] }],
			},
		},
		getCouponsByProductController,
	);

	server.delete(
		'/coupon/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Delete a coupon from Stripe by its ID.',
				params: z.object({ id: z.string() }),
				response: {
					200: deleteCouponResponseSchema,
					500: ErrorSchema,
				},
				tags: ['Coupons'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteCouponController,
	);
}
