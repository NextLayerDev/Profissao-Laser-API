import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { laserPrepController } from '../controllers/laser-prep.js';
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
	vectorizePreviewController,
} from '../controllers/vectorize.js';
import { authenticateVectorizacao } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import { laserPrepResultSchema } from '../types/laser-prep.js';
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
					'Vetoriza uma imagem com o motor Potrace (trace/posterize).',
					'Envio via **multipart/form-data**. Resposta traz o SVG inline',
					'(`svgContent`) + `pngUrl` + `dxfContent` + `id`.',
					'',
					'| Field | Type | Default | Description |',
					'|-------|------|---------|-------------|',
					'| `file` | **binary** | — | Imagem a vetorizar (obrigatório) |',
					'| `preset` | string | — | `rapido` / `detalhado` / `svg` (rótulo) |',
					'| `mode` | string | `trace` | Algoritmo: `trace` ou `posterize` |',
					'| `threshold` | number | `128` | Limiar P&B (0–255) |',
					'| `turdSize` | number | `5` | Suprime manchas até este tamanho |',
					'| `optTolerance` | number | `0.2` | Tolerância de otimização de curva |',
					'| `alphaMax` | number | `1` | Limiar de canto |',
					'| `turnPolicy` | string | — | black/white/left/right/minority/majority |',
					'| `blackOnWhite` | boolean | `true` | Lado do limiar a traçar |',
					'| `invert` | boolean | `false` | Inverter cores |',
					'| `blur` | number | — | Desfoque (0.3–20) |',
					'| `sharpen` | boolean | `false` | Nitidez |',
					'| `brightness` | number | — | Brilho (0.1–3.0) |',
					'| `contrast` | number | — | Contraste (0.1–3.0) |',
					'| `gamma` | number | — | Gamma (1.0–3.0) |',
					'| `edgeDetection` | string | `none` | none/sobel/canny |',
					'| `ditherAlgorithm` | string | — | floydSteinberg/atkinson/stucki/jarvis/sierra/ordered/halftone |',
					'| `posterizeLevels` | number | `4` | Níveis do posterize (2–10) |',
					'| `posterizeFillStrategy` | string | `dominant` | dominant/mean/median/spread |',
					'| `posterizeRangeDistribution` | string | `auto` | auto/equal |',
					'| `drawingStyle` | string | `fill` | fill/stroke/outline |',
					'| `color` | string | `#000000` | Cor do traço/preenchimento |',
					'| `strokeWidth` | number | `1` | Largura do traço |',
					'| `nonScalingStroke` | boolean | `false` | vector-effect non-scaling |',
					'| `linePattern` | string | `none` | none/horizontal/vertical/diagonal45/diagonal135/crosshatch/diamondHatch |',
					'| `lineSpacing` | number | `3` | Espaçamento das linhas (0.5–10) |',
					'| `lineAngle` | number | — | Ângulo das linhas (0–360) |',
					'| `dpi` | number | — | DPI p/ dimensionar em mm (72–360) |',
					'| `outputWidth` | number | — | Largura de saída (mm) |',
					'| `outputHeight` | number | — | Altura de saída (mm) |',
					'| `svgOptimize` | boolean | `false` | Simplifica os paths |',
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
		'/api/vectorize/preview',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: [
					'Preview rápido e **NÃO cobrado** da vetorização (sem storage/DB).',
					'Mesmos campos de `POST /api/vectorize`; o input é reduzido p/ ~600px',
					'e a resposta traz apenas `{ svgContent }`. Para feedback ao vivo dos',
					'sliders — o run final (cobrado) continua em `POST /api/vectorize`.',
				].join('\n'),
				consumes: ['multipart/form-data'],
				response: {
					200: z.object({ svgContent: z.string() }),
					400: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		vectorizePreviewController,
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

	server.post(
		'/api/laser-prep',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: [
					'Prepara uma foto para gravação a laser (Gravação 1-Clique / fotogravação).',
					'Porte do pipeline ImagR "One Click": flatten sobre branco → cinza Rec.709 →',
					'tom por material (gamma/contraste/inversão) → resize físico (Lanczos) →',
					'dithering (Floyd–Steinberg por padrão) → PNG 1-bit com DPI embutido.',
					'',
					'Envio via **multipart/form-data**. Resposta traz `pngUrl` + `pngBase64`',
					'(inline `data:image/png;base64,...`) + dimensões físicas e em px + `id`.',
					'',
					'| Field | Type | Default | Description |',
					'|-------|------|---------|-------------|',
					'| `image` | **binary** | — | Imagem de entrada (obrigatório) |',
					'| `material` | string | — | wood / black slate / glass / acrylic / leather / cork / andonized aluminum / stainless steel / white tile / white tile painted black |',
					'| `width_mm` | number | — | Largura física em mm (>0). Altura recalculada pela proporção |',
					'| `dpi` | number | `254` | Densidade de px (mm→px) |',
					'| `noDither` | boolean | — | `true` desliga o dithering (senão usa o default do material) |',
					'| `ditherAlgorithm` | string | — | floydSteinberg/atkinson/stucki/jarvis/sierra/ordered/halftone |',
					'| `invocation_id` | string | — | (opcional) id da invocação cobrada pelo upvox |',
				].join('\n'),
				consumes: ['multipart/form-data'],
				response: {
					201: laserPrepResultSchema,
					400: ErrorSchema,
					402: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		laserPrepController,
	);
}
