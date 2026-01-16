import type { FastifyInstance } from 'fastify';
import { authRoute } from '@/routes/auth.route';

export const routes = async (app: FastifyInstance) => {
	app.register(authRoute);
};
