import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createImageSizePresetController,
	deleteImageSizePresetController,
	listImageSizePresetsController,
	updateImageSizePresetController,
} from '../controllers/image-size-preset.js';
import { authenticate, authenticateAdmin } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	createImageSizePresetSchema,
	imageSizePresetSchema,
	updateImageSizePresetSchema,
} from '../types/image-size-preset.js';

const idParams = z.object({ id: z.string() });

/**
 * Resoluções padrão (globais) que o admin cadastra pra usar como tamanho de
 * saída da IA nos itens do Banco — ver `data.image_size` em `tool-bank.ts`.
 */
export async function imageSizePresetRoute(app: FastifyInstance) {
	app.get(
		'/api/image-size-presets',
		{
			preHandler: [authenticate],
			schema: {
				description: 'Lista as resoluções padrão cadastradas.',
				response: { 200: z.array(imageSizePresetSchema) },
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		listImageSizePresetsController,
	);

	app.post(
		'/api/image-size-presets',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Cria uma resolução padrão (admin).',
				body: createImageSizePresetSchema,
				response: {
					201: imageSizePresetSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		createImageSizePresetController,
	);

	app.patch(
		'/api/image-size-presets/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Atualiza uma resolução padrão (admin).',
				params: idParams,
				body: updateImageSizePresetSchema,
				response: {
					200: imageSizePresetSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateImageSizePresetController,
	);

	app.delete(
		'/api/image-size-presets/:id',
		{
			preHandler: [authenticateAdmin],
			schema: {
				description: 'Exclui uma resolução padrão (admin).',
				params: idParams,
				response: { 204: z.null(), 400: ErrorSchema, 403: ErrorSchema },
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteImageSizePresetController,
	);
}
