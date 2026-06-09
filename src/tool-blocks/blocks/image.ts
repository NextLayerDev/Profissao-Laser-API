import { z } from 'zod';
import { parseVectorizeParams, vectorizeImage } from '../../lib/vectorize.js';
import type { ToolBlock } from '../types.js';

/**
 * `image.input` — porta de entrada da imagem no pipeline. O motor já colocou o
 * buffer do upload na bag como `input.<nome>`; este bloco só o valida e o
 * re-expõe como `<nodeId>.buffer`, deixando o pipeline explícito (blocos
 * seguintes referenciam `<nodeId>.buffer`).
 */
const imageInputSchema = z.object({
	from: z.instanceof(Buffer),
});

export const imageInputBlock: ToolBlock<z.infer<typeof imageInputSchema>> = {
	id: 'image.input',
	category: 'image',
	description: 'Entrada de imagem (valida e expõe o buffer do upload).',
	paramsSchema: imageInputSchema,
	async run(_ctx, params) {
		return { buffer: params.from };
	},
};

/**
 * `image.vectorize` — embrulha `vectorizeImage()`. Recebe o buffer + os mesmos
 * parâmetros de vetorização (reusa `parseVectorizeParams` pra defaults/validação)
 * e devolve o SVG como string.
 */
const imageVectorizeSchema = z
	.object({ image: z.instanceof(Buffer) })
	.catchall(z.unknown());

export const imageVectorizeBlock: ToolBlock<
	z.infer<typeof imageVectorizeSchema>
> = {
	id: 'image.vectorize',
	category: 'image',
	description: 'Vetoriza uma imagem (raster → SVG) via Potrace/posterize.',
	paramsSchema: imageVectorizeSchema,
	async run(_ctx, params) {
		// parseVectorizeParams espera um mapa de strings (como vem do multipart);
		// serializamos os params resolvidos (exceto a imagem) pra reusar defaults.
		const fields: Record<string, string> = {};
		for (const [k, v] of Object.entries(params)) {
			if (k === 'image' || v === undefined || v === null) continue;
			fields[k] = typeof v === 'string' ? v : String(v);
		}
		const vp = parseVectorizeParams(fields);
		const svg = await vectorizeImage(params.image, vp);
		return { svg };
	},
};
