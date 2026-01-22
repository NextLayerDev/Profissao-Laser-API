import type { FastifyInstance } from 'fastify';
import { checkoutRoute } from '@/routes/checkout.route';
import { customerRoutes } from '@/routes/customer.route';
import { productRoute } from '@/routes/product.route';
import { purchaseRoute } from '@/routes/purchase.route';
import { userRoutes } from '@/routes/user.route';
import { webhookRoute } from '@/routes/webhook.route';

export async function routes(app: FastifyInstance) {
	app.register(userRoutes);
	app.register(customerRoutes);
	app.register(productRoute);
	app.register(checkoutRoute);
	app.register(webhookRoute);
	app.register(purchaseRoute);
}
