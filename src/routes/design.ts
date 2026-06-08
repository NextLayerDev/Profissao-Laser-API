import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createDesignController,
	deleteDesignController,
	getDesignController,
	listDesignsController,
	updateDesignController,
	uploadDesignThumbnailController,
} from '../controllers/design.js';
import { authenticateCustomer } from '../middleware/auth.js';
import {
	createDesignSchema,
	designListQuerySchema,
	designListResponseSchema,
	designSchema,
	updateDesignSchema,
} from '../types/design.js';
import { ErrorSchema } from '../types/error.js';

export async function designRoute(server: FastifyInstance) {
	server.get(
		'/designs',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Lista designs do customer logado.',
				querystring: designListQuerySchema,
				response: {
					200: designListResponseSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Designs'],
				security: [{ bearerAuth: [] }],
			},
		},
		listDesignsController,
	);

	server.get(
		'/designs/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Detalhe de um design (apenas se pertencer ao customer).',
				params: z.object({ id: z.string() }),
				response: {
					200: designSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Designs'],
				security: [{ bearerAuth: [] }],
			},
		},
		getDesignController,
	);

	server.post(
		'/designs',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Cria um novo design vazio (canvasJson inicial fornecido pelo cliente).',
				body: createDesignSchema,
				response: {
					201: designSchema,
					400: ErrorSchema,
					403: ErrorSchema,
				},
				tags: ['Designs'],
				security: [{ bearerAuth: [] }],
			},
		},
		createDesignController,
	);

	server.put(
		'/designs/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Salva alterações no design (canvasJson, name, notes, thumbnailUrl).',
				params: z.object({ id: z.string() }),
				body: updateDesignSchema,
				response: {
					200: designSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Designs'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateDesignController,
	);

	server.post(
		'/designs/:id/thumbnail',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: [
					'Upload do thumbnail (export PNG do canvas) via **multipart/form-data**.',
					'',
					'| Field | Type | Required | Description |',
					'|-------|------|:--------:|-------------|',
					'| `file` | **binary** | ✓ | PNG do canvas |',
				].join('\n'),
				params: z.object({ id: z.string() }),
				consumes: ['multipart/form-data'],
				response: {
					200: designSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Designs'],
				security: [{ bearerAuth: [] }],
			},
		},
		uploadDesignThumbnailController,
	);

	server.delete(
		'/designs/:id',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: 'Remove o design e o thumbnail do CDN.',
				params: z.object({ id: z.string() }),
				response: {
					204: z.null(),
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Designs'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteDesignController,
	);
}
