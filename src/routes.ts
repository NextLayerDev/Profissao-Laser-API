import type { FastifyInstance } from 'fastify';
import { customerAuthRoute } from '@/routes/customer.route';
import { userAuthRoute } from '@/routes/user.route';

export async function routes(app: FastifyInstance) {
	app.register(userAuthRoute);
	app.register(customerAuthRoute);
}
