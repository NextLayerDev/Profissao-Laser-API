import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	deleteWatermarkController,
	getWatermarkController,
	putWatermarkController,
} from '../controllers/watermark.js';
import { authenticateCustomer } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import { customerWatermarkSchema } from '../types/watermark.js';

export async function watermarkRoute(server: FastifyInstance) {
	server.get(
		'/watermark',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					"Retorna a marca d'água salva do customer logado. 404 se não tiver cadastrada.",
				response: {
					200: customerWatermarkSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Watermark'],
				security: [{ bearerAuth: [] }],
			},
		},
		getWatermarkController,
	);

	server.put(
		'/watermark',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: [
					"Upload/atualiza a marca d'água do customer via **multipart/form-data**.",
					'Singleton: sobrescreve a anterior e remove a imagem antiga do CDN.',
					'',
					'| Field | Type | Required | Description |',
					'|-------|------|:--------:|-------------|',
					'| `file` | **binary** | ✓ | Imagem PNG/JPG (idealmente PNG com transparência) |',
				].join('\n'),
				consumes: ['multipart/form-data'],
				response: {
					200: customerWatermarkSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Watermark'],
				security: [{ bearerAuth: [] }],
			},
		},
		putWatermarkController,
	);

	server.delete(
		'/watermark',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: "Remove a marca d'água do customer (DB + CDN).",
				response: {
					204: z.null(),
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Watermark'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteWatermarkController,
	);
}
