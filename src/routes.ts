import type { FastifyInstance } from 'fastify';
import { authRoute } from '@/routes/auth.route';
import { customerRoute } from '@/routes/customer.route';
import { permissionsRoute } from '@/routes/permissions.route';
import { userRoute } from '@/routes/user.route';

export const routes = async (app: FastifyInstance) => {
	app.register(authRoute);
	app.register(userRoute);
	app.register(customerRoute);
	app.register(permissionsRoute);
};
