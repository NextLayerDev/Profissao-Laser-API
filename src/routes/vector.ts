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
	aiLineartController,
	downloadVectorFormatController,
	exportVectorController,
	invertVectorController,
	vectorizeAnalyzeController,
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
	imageProfileSchema,
	invertModeSchema,
	invertVectorResultSchema,
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
		'/api/vectorize/:id/download/:format',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: [
					'Cobra o download de UM formato (`svg`/`png`/`dxf`) de um vetor.',
					'A geração é grátis; a cobrança de voxxys acontece aqui, **por formato**.',
					'Formato já pago (inclusive re-download da biblioteca) **não cobra** de novo.',
					'',
					'Fluxo: o front invoca a tool no upvox (debita) e envia o `invocation_id`;',
					'gravamos o formato como pago e liquidamos. Devolve `paidFormats` atualizado.',
				].join('\n'),
				params: z.object({
					id: z.string().uuid(),
					format: z.enum(['svg', 'png', 'dxf']),
				}),
				body: z.object({ invocation_id: z.string().optional() }),
				response: {
					200: z.object({ paidFormats: z.array(z.string()) }),
					402: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		downloadVectorFormatController,
	);

	server.post(
		'/api/vectorize/:id/invert',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: [
					'**Vetor invertido** (fundo preto): devolve o negativo REAL do vetor —',
					'o Corel/LightBurn e o laser enxergam a polaridade trocada, não é só a',
					'cor da prévia. **Não cobra** e não altera `paidFormats`: quem já pagou',
					'um formato baixa a versão invertida sem custo novo.',
					'',
					'`mode`: `geometric` = complemento exato (moldura do viewBox com a arte',
					'como furos, `fill-rule="evenodd"`), lossless — para logo/texto/traço.',
					'`silhouette` = negativo morfológico (silhueta sólida + borda, linhas',
					'como furos) — para gravura hachurada, onde o complemento viraria uma',
					'chapa preta. `auto` (default) escolhe pela densidade e espessura do traço.',
					'',
					'**DXF**: o formato não tem preenchimento, então a inversão só acrescenta',
					'o retângulo da moldura — a troca de polaridade é invisível no DXF.',
					'',
					'422 quando a arte não tem negativo geométrico confiável (multi-cor, ou',
					'`transform` na árvore).',
				].join('\n'),
				params: z.object({ id: z.string().uuid() }),
				body: z.object({
					mode: invertModeSchema.optional(),
					/**
					 * Guarda o invertido em "Meus vetores" (idempotente por pai+modo).
					 * O registro HERDA `paid_formats` do pai — mesmo vetor, não recobra.
					 */
					persist: z.boolean().optional(),
				}),
				response: {
					200: invertVectorResultSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					422: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		invertVectorController,
	);

	server.post(
		'/api/vectorize/ai-lineart',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: [
					'Line-art com **IA** (foto → gravura "nanquim"; logo → redesenho vetorial',
					'fiel → vetor Potrace). Único caminho que atinge o nível de gravura pro.',
					'**Cobrada NA GERAÇÃO** (a IA custa): o front invoca (debita) e manda o',
					'`invocation_id`; o resultado já sai com todos os formatos pagos.',
					'Envio **multipart/form-data** (campo `image`).',
					'',
					'O **prompt é escolhido no servidor** (foto vs logo, detecção heurística',
					'com desempate por visão) — o front não decide e nada disso aparece na UI.',
					'`variant` só distingue `color` (Laser + UV) do P&B.',
					'',
					'Toda saída passa por verificação estrutural contra a imagem de entrada.',
					'Se a IA não reproduzir a arte, refazemos 1× com prompt mais rígido; se',
					'falhar de novo, **estornamos** e devolvemos a vetorização normal com',
					'`aiFallback: true` e `paidFormats: []` (volta ao fluxo grátis).',
				].join('\n'),
				consumes: ['multipart/form-data'],
				response: {
					201: vectorizeResultSchema,
					400: ErrorSchema,
					402: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
					502: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		aiLineartController,
	);

	server.post(
		'/api/vectorize/analyze',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: [
					'Análise automática (router + image analytics) — **NÃO cobrada**, sem',
					'storage. Recebe a imagem (multipart, campo `file`) e devolve o tipo',
					'detectado + `recommendedParams` que o modo Automático do front aplica.',
				].join('\n'),
				consumes: ['multipart/form-data'],
				response: {
					200: imageProfileSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		vectorizeAnalyzeController,
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
