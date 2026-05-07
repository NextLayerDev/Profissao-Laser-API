import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateVectorizacao } from '@/middleware/auth.js';
import {
	vectorizeBatchController,
	vectorizeController,
	vectorizeExportController,
} from '../controllers/vectorize.js';
import { ErrorSchema } from '../types/error.js';
import {
	vectorizeBatchSchema,
	vectorizeResultSchema,
} from '../types/vector.js';

export async function vectorizeRoute(server: FastifyInstance) {
	server.post(
		'/api/vectorize',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description:
					'Vectorize a raster image. Multipart with `file` plus optional fields: mode, detailLevel, smoothing, noiseReduction, blackAndWhite, invertColors.',
				response: {
					200: vectorizeResultSchema,
					400: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectorize'],
				security: [{ bearerAuth: [] }],
			},
		},
		vectorizeController,
	);

	server.post(
		'/api/vectorize/batch',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description:
					'Batch vectorize. Body accepts an array of files (name + base64 content) and optional params.',
				body: vectorizeBatchSchema,
				response: {
					200: z.object({
						results: z.array(
							z.object({
								name: z.string(),
								svgContent: z.string(),
								svgUrl: z.string().nullable().optional(),
								params: z.unknown(),
							}),
						),
						params: z.unknown(),
					}),
					400: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectorize'],
				security: [{ bearerAuth: [] }],
			},
		},
		vectorizeBatchController,
	);

	server.post(
		'/api/vectorize/export/:format',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description:
					'Export a generated SVG to alternative formats (SVG passthrough, DXF, or PNG).',
				params: z.object({
					format: z.enum(['svg', 'dxf', 'png']),
				}),
				body: z.object({ svgContent: z.string() }),
				tags: ['Vectorize'],
				security: [{ bearerAuth: [] }],
			},
		},
		vectorizeExportController,
	);
}
