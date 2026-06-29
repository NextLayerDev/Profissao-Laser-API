import sharp from 'sharp';
import { z } from 'zod';
import { parseVectorizeParams, vectorizeImage } from '../../lib/vectorize.js';
import { type FxOutput, fxFromPng } from '../lib/pixels.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos de VETOR/UTIL (categoria `vector`) — port do grupo de saída vetorial do
 * ImagR + utilitários de impressão. `vector.contour` reusa o motor de vetorização
 * (Potrace) e devolve `{ svg }`. `util.dpiTest` NÃO recebe imagem: gera um cartão
 * de calibração de DPI (régua/grade de tamanho conhecido) e rasteriza com sharp,
 * devolvendo `{ png, pngBase64 }`.
 */

const img = z.instanceof(Buffer);

/** Açúcar: define um bloco de vetor com schema {image, ...P} (mesmo do adjust.ts). */
function block<P extends z.ZodRawShape>(
	id: string,
	description: string,
	shape: P,
	run: (
		params: z.infer<z.ZodObject<P & { image: typeof img }>>,
	) => Promise<Record<string, unknown>>,
): ToolBlock {
	const schema = z.object({ image: img, ...shape });
	return {
		id,
		category: 'vector',
		description,
		paramsSchema: schema as z.ZodType<unknown>,
		run: (_ctx, params) =>
			run(params as z.infer<z.ZodObject<P & { image: typeof img }>>),
	} as ToolBlock;
}

/* ───────────────────────────── Contorno (vetor) ───────────────────────────── */

export const contourBlock = block(
	'vector.contour',
	'Contorno vetorial: traça o limiar como linha (stroke) e devolve SVG.',
	{
		threshold: z.coerce.number().int().min(0).max(255).default(128),
		color: z.string().default('#000000'),
	},
	async (p) => {
		// Reusa o motor de vetorização no modo "stroke" (só o contorno, sem preenchimento).
		const vp = parseVectorizeParams({
			threshold: String(p.threshold),
			drawingStyle: 'stroke',
			color: p.color,
		});
		const svg = await vectorizeImage(p.image, vp);
		return { svg };
	},
);

/* ───────────────────────────── Teste de DPI (util) ───────────────────────────── */

const dpiTestSchema = z.object({
	dpi: z.coerce.number().int().min(72).max(1200).default(254),
});

/** Escapa texto pra inserir com segurança num SVG. */
function xmlEscape(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const dpiTestBlock: ToolBlock<z.infer<typeof dpiTestSchema>> = {
	id: 'util.dpiTest',
	category: 'vector',
	description:
		'Cartão de teste de DPI: gera uma régua/grade de 25,4 mm e rasteriza no DPI escolhido.',
	paramsSchema: dpiTestSchema,
	async run(_ctx, params): Promise<FxOutput> {
		const dpi = params.dpi;
		// 1 polegada = 25,4 mm → no DPI escolhido vira exatamente `dpi` px.
		const inchPx = dpi; // quadrado de referência de 25,4 mm
		const margin = Math.round(dpi * 0.25); // 1/4 pol de margem
		const labelH = Math.round(dpi * 0.4); // faixa pro texto
		const grid = 10; // 10×10 divisões (cada célula = 2,54 mm)
		const cell = inchPx / grid;
		const W = inchPx + margin * 2;
		const H = inchPx + margin * 2 + labelH;
		const x0 = margin;
		const y0 = margin;

		// Linhas internas da grade (cada 2,54 mm).
		const lines: string[] = [];
		for (let i = 1; i < grid; i++) {
			const x = x0 + cell * i;
			const y = y0 + cell * i;
			lines.push(
				`<line x1="${x.toFixed(2)}" y1="${y0}" x2="${x.toFixed(2)}" y2="${y0 + inchPx}" />`,
			);
			lines.push(
				`<line x1="${x0}" y1="${y.toFixed(2)}" x2="${x0 + inchPx}" y2="${y.toFixed(2)}" />`,
			);
		}

		const fontSize = Math.round(dpi * 0.18);
		const label = xmlEscape(
			`${dpi} DPI — quadrado = 25,4 mm (1 pol) — grade = 2,54 mm`,
		);
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>
<g stroke="#cccccc" stroke-width="1">${lines.join('')}</g>
<rect x="${x0}" y="${y0}" width="${inchPx}" height="${inchPx}" fill="none" stroke="#000000" stroke-width="2"/>
<text x="${x0}" y="${y0 + inchPx + labelH * 0.6}" font-family="sans-serif" font-size="${fontSize}" fill="#000000">${label}</text>
</svg>`;

		// O SVG já foi dimensionado em px (1 unidade de usuário = 1 px @ `dpi`):
		// density=72 mantém 1:1 (SVG é interpretado a 72 dpi), então o quadrado
		// sai exatamente com `dpi` px de lado = 25,4 mm impressos naquele DPI.
		const png = await sharp(Buffer.from(svg), { density: 72 }).png().toBuffer();
		return fxFromPng(png);
	},
};

/** Todos os blocos de vetor/util, pra registro no index. */
export const vectorExtraBlocks: ToolBlock[] = [contourBlock, dpiTestBlock];
