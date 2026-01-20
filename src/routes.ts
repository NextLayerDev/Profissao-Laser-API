import type { FastifyInstance } from 'fastify';
import { checkoutRoute } from '@/routes/checkout.route';
import { customerAuthRoute } from '@/routes/customer.route';
import { productRoute } from '@/routes/product.route';
import { purchaseRoute } from '@/routes/purchase.route';
import { userAuthRoute } from '@/routes/user.route';
import { webhookRoute } from '@/routes/webhook.route';

export async function routes(app: FastifyInstance) {
	app.register(userAuthRoute);
	app.register(customerAuthRoute);
	app.register(productRoute);
	app.register(checkoutRoute);
	app.register(webhookRoute);
	app.register(purchaseRoute);
}
