import crypto from 'node:crypto';
import { z } from 'zod';
import { uploadToolOutput } from '../../lib/storage.js';
import type { ToolBlock } from '../types.js';

/**
 * `output.upload_png` — sobe um Buffer PNG pro storage (Bunny) e devolve a URL
 * pública. O path é `${customerId}/${uuid}.png` (sem nome do usuário → sem path
 * traversal); o `folder` vem da definition (admin) e é higienizado no storage.
 */
const uploadPngSchema = z.object({
	from: z.instanceof(Buffer),
	folder: z.string().default('tool-output'),
});

export const outputUploadPngBlock: ToolBlock<z.infer<typeof uploadPngSchema>> =
	{
		id: 'output.upload_png',
		category: 'output',
		description: 'Sobe um PNG pro storage e devolve a URL pública.',
		paramsSchema: uploadPngSchema,
		async run(ctx, params) {
			const path = `${ctx.customerId}/${crypto.randomUUID()}.png`;
			const url = await uploadToolOutput(
				params.folder,
				params.from,
				path,
				'image/png',
			);
			return { url };
		},
	};

/**
 * `output.upload_svg` — sobe um SVG (string) pro storage e devolve a URL.
 * Teto de 20 MB de texto: um Potrace alimentado com entrada patológica pode
 * gerar um SVG com milhões de nós; sem teto, o Buffer + base64 estouram memória.
 */
const MAX_SVG_BYTES = 20 * 1_000_000;
const uploadSvgSchema = z.object({
	from: z.string().min(1).max(MAX_SVG_BYTES),
	folder: z.string().default('tool-output'),
});

export const outputUploadSvgBlock: ToolBlock<z.infer<typeof uploadSvgSchema>> =
	{
		id: 'output.upload_svg',
		category: 'output',
		description: 'Sobe um SVG pro storage e devolve a URL pública.',
		paramsSchema: uploadSvgSchema,
		async run(ctx, params) {
			const path = `${ctx.customerId}/${crypto.randomUUID()}.svg`;
			const url = await uploadToolOutput(
				params.folder,
				Buffer.from(params.from, 'utf8'),
				path,
				'image/svg+xml',
			);
			return { url };
		},
	};

/**
 * `output.return_base64` — devolve um Buffer como data URL inline (sem subir).
 */
const returnBase64Schema = z.object({
	from: z.instanceof(Buffer),
	mime: z.string().default('image/png'),
});

export const outputReturnBase64Block: ToolBlock<
	z.infer<typeof returnBase64Schema>
> = {
	id: 'output.return_base64',
	category: 'output',
	description: 'Devolve um buffer como data URL base64 inline.',
	paramsSchema: returnBase64Schema,
	async run(_ctx, params) {
		return {
			dataUrl: `data:${params.mime};base64,${params.from.toString('base64')}`,
		};
	},
};
