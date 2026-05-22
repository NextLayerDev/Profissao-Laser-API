import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createLaserLineTypeController,
	deleteLaserLineTypeController,
	listLaserLineTypesController,
	updateLaserLineTypeController,
} from '../controllers/laser-line-type.js';
import { authenticate, authenticateAdmin } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	laserLineTypeSchema,
	listLaserLineTypesQuerySchema,
} from '../types/laser-line-type.js';

export async function laserLineTypeRoute(server: FastifyInstance) {
	server.get(
		'/laser-line-types',
		{
			preHandler: [authenticate],
			schema: {
				description:
					'Lista os tipos de linha catalogados. Filtra por software (Ezcad/Lightburn/LaserGRBL).',
				querystring: listLaserLineTypesQuerySchema,
				response: {
					200: z.array(laserLineTypeSchema),
					500: ErrorSchema,
				},
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		listLaserLineTypesController,
	);

	server.post(
		'/laser-line-types',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Cria um tipo de linha com upload de imagem (multipart: file + software + name + order). Staff only.',
				consumes: ['multipart/form-data'],
				response: {
					201: laserLineTypeSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		createLaserLineTypeController,
	);

	server.patch(
		'/laser-line-types/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description:
					'Atualiza tipo de linha. Multipart (com file) troca imagem; JSON puro só metadados. Staff only.',
				params: z.object({ id: z.string() }),
				response: {
					200: laserLineTypeSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
				},
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateLaserLineTypeController,
	);

	server.delete(
		'/laser-line-types/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Remove tipo de linha + imagem. Staff only.',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Parameters'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteLaserLineTypeController,
	);
}
