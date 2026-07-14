import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export async function healthRoute(server: FastifyInstance) {
	server.get(
		'/health',
		{
			schema: {
				description: 'Healthcheck endpoint (e.g. for Uptime Kuma).',
				response: { 200: z.object({ status: z.literal('ok') }) },
				tags: ['Health'],
			},
		},
		async (_request, reply) => reply.send({ status: 'ok' }),
	);
}
