import sharp from 'sharp';
import { z } from 'zod';
import { ToolEngineError } from '../../lib/tool-errors.js';
import { parseVectorizeParams, vectorizeImage } from '../../lib/vectorize.js';
import type { ToolBlock } from '../types.js';

/**
 * Teto de pixels da imagem de ENTRADA (200 MP). Defesa contra OOM/DoS: o sharp
 * decodifica imagens arbitrariamente grandes e nem todo bloco downstream tem
 * teto próprio (o laserPrep limita a SAÍDA; a vetorização não limita a entrada).
 * Validar aqui, no bloco de entrada, protege TODA tool de imagem de uma vez.
 */
const MAX_INPUT_PIXELS = 200 * 1_000_000;

/**
 * `image.input` — porta de entrada da imagem no pipeline. O motor já colocou o
 * buffer do upload na bag como `input.<nome>`; este bloco valida o tamanho
 * (teto de pixels) e o re-expõe como `<nodeId>.buffer`, deixando o pipeline
 * explícito (blocos seguintes referenciam `<nodeId>.buffer`).
 */
const imageInputSchema = z.object({
	from: z.instanceof(Buffer),
});

export const imageInputBlock: ToolBlock<z.infer<typeof imageInputSchema>> = {
	id: 'image.input',
	category: 'image',
	description: 'Entrada de imagem (valida tamanho e expõe o buffer do upload).',
	paramsSchema: imageInputSchema,
	async run(_ctx, params) {
		// Lê só os metadados (sem decodificar o raster) pra barrar imagens enormes
		// antes que qualquer bloco aloque memória proporcional a width×height.
		const meta = await sharp(params.from).metadata();
		const w = meta.width ?? 0;
		const h = meta.height ?? 0;
		if (w * h > MAX_INPUT_PIXELS) {
			throw new ToolEngineError(
				400,
				`Imagem grande demais: ${w}x${h}px excede o teto de ${
					MAX_INPUT_PIXELS / 1_000_000
				} MP.`,
			);
		}
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
