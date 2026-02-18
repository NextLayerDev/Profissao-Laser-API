import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.js';
import { getCourseContentController } from '../controllers/course.js';
import { ErrorSchema } from '../types/error.js';
import { courseContentSchema } from '../types/product.js';

export async function courseRoute(server: FastifyInstance) {
	server.get(
		'/course/:slug',
		{
			// preHandler: [authenticate],
			schema: {
				description:
					'Get course content with modules and lessons for a given slug.',
				params: z.object({ slug: z.string() }),
				response: {
					200: courseContentSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Course'],
				security: [{ bearerAuth: [] }],
			},
		},
		getCourseContentController,
	);
}
