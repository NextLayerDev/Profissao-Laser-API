import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
	toolPreviewController,
	toolRunController,
} from '../controllers/tool-run.js';
import { authenticateVectorizacao } from '../middleware/auth.js';
import { ErrorSchema } from '../types/error.js';
import {
	toolPreviewResultSchema,
	toolRunResultSchema,
} from '../types/tool-run.js';

export async function toolRunRoute(server: FastifyInstance) {
	server.post(
		'/api/tool-run/:key',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: [
					'Motor genérico da Fábrica de Tools: roda qualquer ToolDefinition',
					'(`blocks_v1`) publicada no upvox, por `key`. Espelha o billing do',
					'`/api/laser-prep` (invoke→settle/refund no upvox).',
					'',
					'Envio via **multipart/form-data**: o arquivo (quando a tool tem input',
					'de imagem) + um campo por input declarado na definition +',
					'`invocation_id` (opcional, id da invocação cobrada pelo upvox).',
					'',
					'`image_size` (opcional): JSON string no formato',
					'`{"unit":"px","width":1024,"height":768}` (ou `unit:"mm"` com `dpi`,',
					'ou `unit:"preset","preset_id":"..."` — ver `GET /api/image-size-presets`).',
					'Escolhido pelo cliente na hora da geração, vence o tamanho do item do',
					'banco e o tamanho default da tool. Envie a string literal `"native"`',
					'pra manter o tamanho nativo gerado pela IA (sem redimensionar).',
					'',
					'Staff pode enviar `definition` (JSON inline) pra **preview de rascunho**',
					'— nesse modo não cobra.',
					'',
					'Resposta: `{ id, output }`, onde `output` é a projeção de',
					'`definition.output` (forma varia por tool).',
				].join('\n'),
				consumes: ['multipart/form-data'],
				params: z.object({ key: z.string().min(1).max(60) }),
				response: {
					201: toolRunResultSchema,
					400: ErrorSchema,
					402: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
					502: ErrorSchema,
				},
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		toolRunController,
	);

	// Preview NÃO cobrado (feedback ao vivo dos sliders no estúdio): roda o
	// pipeline sem nós de saída/IA, sem debitar nem gravar. Devolve `{ preview }`
	// e, nas tools de CAD, `{ assembly }` — a montagem 3D não é imagem.
	server.post(
		'/api/tool-run/:key/preview',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description:
					'Preview ao vivo NÃO COBRADO de uma tool (estúdio): imagem reduzida, sem storage, sem IA. Staff pode mandar `definition` inline. Resposta: `{ preview }` (data URL base64 ou null) e, em tools de CAD, `{ assembly }` (montagem 3D do bloco `cad.assembly`, para o viewport).',
				consumes: ['multipart/form-data'],
				params: z.object({ key: z.string().min(1).max(60) }),
				response: {
					200: toolPreviewResultSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					404: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Tools'],
				security: [{ bearerAuth: [] }],
			},
		},
		toolPreviewController,
	);
}
