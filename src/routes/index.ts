import type { FastifyInstance } from 'fastify';
import { authRoutes } from '@/routes/auth';
import { checkoutRoute } from '@/routes/checkout';
import { customerRoutes } from '@/routes/customer';
import { productRoute } from '@/routes/product';
import { purchaseRoute } from '@/routes/purchase';
import { usersRoutes } from '@/routes/user';

export async function routes(app: FastifyInstance) {
	app.register(authRoutes);
	app.register(usersRoutes);
	app.register(customerRoutes);
	app.register(productRoute);
	app.register(checkoutRoute);
	app.register(purchaseRoute);
}
