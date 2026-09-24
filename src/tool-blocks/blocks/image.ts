import sharp from 'sharp';
import { z } from 'zod';
import { ToolEngineError } from '../../lib/tool-errors.js';
import { parseVectorizeParams, vectorizeImage } from '../../lib/vectorize.js';
import { extractPalette } from '../../lib/vectorize-color.js';
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

/**
 * Booleano vindo do motor/definition. `z.coerce.boolean()` seria armadilha
 * (`Boolean('false') === true`); ausente vale `true`, que é o padrão útil.
 */
const removerFundo = z.preprocess(
	(v) =>
		v === undefined || v === null
			? true
			: v === true || v === 'true' || v === 1 || v === '1',
	z.boolean(),
);

const imagePaletteSchema = z.object({
	image: z.instanceof(Buffer),
	/** Quantas cores devolver. Marca costuma caber em 3–5. */
	colors: z.coerce.number().int().min(1).max(12).default(5),
	/** Descontar o fundo antes de contar (logo em fundo branco é a regra). */
	remove_background: removerFundo,
});

/**
 * `image.palette` — as cores dominantes de uma imagem, em hex.
 *
 * Serve para sugerir a paleta da marca a partir do logo que o aluno acabou de
 * subir: em vez de perguntar "qual é a sua cor primária?" (pergunta que quase
 * ninguém sabe responder em hexadecimal), a tela lê do próprio logo e mostra
 * para confirmar.
 *
 * É o k-means que já rodava na vetorização em cores, sem o Potrace — puro,
 * local, sem IA e sem custo por chamada. `primary`/`secondary` saem por ÁREA
 * (a cor que mais ocupa o logo é a cor da marca em praticamente todo logo real).
 *
 * ATENÇÃO ao publicar: `output` da definition é ALLOW-LIST. Chave emitida aqui
 * e não listada lá é calculada e jogada fora sem erro nenhum.
 */
export const imagePaletteBlock: ToolBlock<z.infer<typeof imagePaletteSchema>> =
	{
		id: 'image.palette',
		category: 'image',
		description:
			'Cores dominantes de uma imagem em hex (k-means local, sem IA). Devolve `colors`, `palette` (com a fatia de área), `primary` e `secondary`.',
		paramsSchema: imagePaletteSchema,
		async run(_ctx, params) {
			const palette = await extractPalette(params.image, {
				colors: params.colors,
				removeBackground: params.remove_background,
			});
			return {
				// `colors` é a lista crua de hex — é o formato que um prompt de imagem
				// e um campo de texto da coleção conseguem consumir direto.
				colors: palette.map((c) => c.hex),
				palette,
				primary: palette[0]?.hex ?? null,
				secondary: palette[1]?.hex ?? null,
			};
		},
	};
