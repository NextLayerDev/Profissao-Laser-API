import crypto from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { uploadToolOutput } from '../../lib/storage.js';
import { svgToDxf } from '../../lib/vectorize.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos de SAÍDA/EXPORT extra (categoria `output`) — formatos de máquina a
 * laser. Diferente dos blocos de imagem (que recebem `image: Buffer` e devolvem
 * `{png}`), estes recebem `from: ...` (um SVG string ou um PNG Buffer), geram um
 * arquivo no formato-alvo, sobem pro storage e devolvem `{ url }`. Path sempre
 * `${customerId}/${uuid}.<ext>` (sem nome do usuário → sem path traversal).
 * Segue o estilo de `blocks/output.ts` (ToolBlock escrito à mão).
 */

/* ───────────────────────────── DXF ───────────────────────────── */

/**
 * `output.export_dxf` — converte um SVG (string) em DXF (vetor de corte) com
 * `svgToDxf` e sobe pro storage. Devolve a URL pública do .dxf.
 */
const exportDxfSchema = z.object({
	from: z.string().min(1),
	folder: z.string().default('tool-output'),
});

export const outputExportDxfBlock: ToolBlock<z.infer<typeof exportDxfSchema>> =
	{
		id: 'output.export_dxf',
		category: 'output',
		description: 'Converte um SVG em DXF (corte) e devolve a URL pública.',
		paramsSchema: exportDxfSchema,
		async run(ctx, params) {
			const dxf = svgToDxf(params.from);
			const path = `${ctx.customerId}/${crypto.randomUUID()}.dxf`;
			const url = await uploadToolOutput(
				params.folder,
				Buffer.from(dxf, 'utf8'),
				path,
				'application/dxf',
			);
			return { url };
		},
	};

/* ─────────────────────────── LightBurn ─────────────────────────── */

/**
 * `output.export_lbrn2` — gera um arquivo LightBurn `.lbrn2` MÍNIMO (XML) que
 * embute o PNG em base64 dentro de um `<Shape Type="Image">`, com o tamanho
 * físico em mm (largura informada; altura calculada pela proporção da imagem via
 * metadata do sharp). Sobe pro storage e devolve a URL. É um .lbrn2 mínimo
 * (imagem embutida) — abre no LightBurn já dimensionado pra gravação.
 */
const exportLbrn2Schema = z.object({
	from: z.instanceof(Buffer),
	width_mm: z.coerce.number().positive().max(2000).default(100),
	folder: z.string().default('tool-output'),
});

export const outputExportLbrn2Block: ToolBlock<
	z.infer<typeof exportLbrn2Schema>
> = {
	id: 'output.export_lbrn2',
	category: 'output',
	description:
		'Gera um LightBurn .lbrn2 mínimo (PNG embutido) dimensionado em mm.',
	paramsSchema: exportLbrn2Schema,
	async run(ctx, params) {
		// Altura física pela proporção real da imagem (fallback 1:1 se faltar meta).
		const meta = await sharp(params.from).metadata();
		const pxW = meta.width ?? 1;
		const pxH = meta.height ?? 1;
		const widthMm = params.width_mm;
		const heightMm = widthMm * (pxH / pxW);
		const base64 = params.from.toString('base64');
		// .lbrn2 mínimo: 1 shape de imagem com o PNG embutido + tamanho em mm.
		const xml =
			'<?xml version="1.0"?>' +
			'<LightBurnProject AppVersion="1.6" FormatVersion="1">' +
			`<Shape Type="Image" Width="${widthMm.toFixed(3)}" Height="${heightMm.toFixed(3)}">` +
			`<ImageData>${base64}</ImageData>` +
			'</Shape>' +
			'</LightBurnProject>';
		const path = `${ctx.customerId}/${crypto.randomUUID()}.lbrn2`;
		const url = await uploadToolOutput(
			params.folder,
			Buffer.from(xml, 'utf8'),
			path,
			'application/octet-stream',
		);
		return { url };
	},
};

/** Todos os blocos de saída/export extra, pra registro no index. */
export const outputExtraBlocks: ToolBlock[] = [
	outputExportDxfBlock,
	outputExportLbrn2Block,
];
