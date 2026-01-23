import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth';
import { checkoutRoute } from './checkout';
import { customerRoutes } from './customer';
import { productRoute } from './product';
import { purchaseRoute } from './purchase';
import { usersRoutes } from './user';

export async function routes(app: FastifyInstance) {
	app.register(authRoutes);
	app.register(usersRoutes);
	app.register(customerRoutes);
	app.register(productRoute);
	app.register(checkoutRoute);
	app.register(purchaseRoute);
}
