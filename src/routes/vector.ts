import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	createVectorController,
	deleteVectorController,
	getVectorController,
	listVectorsController,
	updateVectorController,
} from '../controllers/vector.js';
import {
	exportVectorController,
	vectorizeBatchController,
	vectorizeController,
} from '../controllers/vectorize.js';
import { authenticateVectorizacao } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	batchVectorizeResultSchema,
	createVectorSchema,
	listVectorsQuery,
	updateVectorSchema,
	vectorizeResultSchema,
	vectorSchema,
} from '../types/vector.js';

export async function vectorRoute(server: FastifyInstance) {
	server.get(
		'/customer/vectors',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'List vectors for a customer (paginated).',
				querystring: listVectorsQuery,
				response: {
					200: z.object({
						data: z.array(vectorSchema),
						total: z.number(),
					}),
					400: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		listVectorsController,
	);

	server.get(
		'/customer/vectors/:id',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'Get a vector by ID.',
				params: z.object({ id: z.string().uuid() }),
				response: {
					200: vectorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		getVectorController,
	);

	server.post(
		'/customer/vectors',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'Create a new vector (upload SVG).',
				body: createVectorSchema,
				response: {
					201: vectorSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		createVectorController,
	);

	server.patch(
		'/customer/vectors/:id',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'Update a vector.',
				params: z.object({ id: z.string().uuid() }),
				body: updateVectorSchema,
				response: {
					200: vectorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		updateVectorController,
	);

	server.delete(
		'/customer/vectors/:id',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: 'Delete a vector.',
				params: z.object({ id: z.string().uuid() }),
				response: {
					204: z.null(),
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		deleteVectorController,
	);

	server.post(
		'/api/vectorize',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: [
					'Vetoriza uma imagem aplicando os parâmetros informados.',
					'Envio via **multipart/form-data**.',
					'',
					'| Field | Type | Required | Default | Description |',
					'|-------|------|:--------:|---------|-------------|',
					'| `file` | **binary** | ✓ | — | Imagem a vetorizar |',
					'| `mode` | string | | `detalhado` | `contorno` / `detalhado` / `preenchimento` |',
					'| `detailLevel` | number | | `50` | Nível de detalhe (0–100) |',
					'| `smoothing` | number | | `0` | Suavização (0–100) |',
					'| `noiseReduction` | number | | `0` | Redução de ruído (0–100) |',
					'| `blackAndWhite` | boolean | | `false` | Converter para P&B |',
					'| `invertColors` | boolean | | `false` | Inverter cores |',
				].join('\n'),
				consumes: ['multipart/form-data'],
				response: {
					201: vectorizeResultSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
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
				description: [
					'Vetoriza múltiplas imagens em lote. Mesmos campos de `POST /api/vectorize`,',
					'mas o campo `file` pode aparecer múltiplas vezes (um por arquivo).',
				].join('\n'),
				consumes: ['multipart/form-data'],
				response: {
					201: batchVectorizeResultSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		vectorizeBatchController,
	);

	server.get(
		'/api/vectorize/export/:format',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: [
					'Exporta um vetor salvo em formato alternativo.',
					'',
					'| Param | Type | Description |',
					'|-------|------|-------------|',
					'| `format` | path | `dxf` ou `png` |',
					'| `id` | query | UUID do vetor (`customer_vectors.id`) |',
					'',
					'PNG redireciona para a URL do preview. DXF retorna o arquivo para download.',
				].join('\n'),
				params: z.object({ format: z.enum(['dxf', 'png']) }),
				querystring: z.object({ id: z.string().uuid() }),
				response: {
					302: z.null(),
					200: z.string(),
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		exportVectorController,
	);
}
