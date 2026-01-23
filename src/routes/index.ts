import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.js';
import { checkoutRoute } from './checkout.js';
import { customerRoutes } from './customer.js';
import { productRoute } from './product.js';
import { purchaseRoute } from './purchase.js';
import { usersRoutes } from './user.js';

export async function routes(app: FastifyInstance) {
	app.register(authRoutes);
	app.register(usersRoutes);
	app.register(customerRoutes);
	app.register(productRoute);
	app.register(checkoutRoute);
	app.register(purchaseRoute);
}
