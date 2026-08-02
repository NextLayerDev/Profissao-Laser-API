import crypto from 'node:crypto';
import { z } from 'zod';
import type { NestResult, Sketch2D } from '../../lib/cad/ir.js';
import { sketchToDxf } from '../../lib/cad/render-dxf.js';
import { sketchToSvg } from '../../lib/cad/render-svg.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos de SAÍDA do motor CAD (categoria `output`): pegam o `Sketch2D` (e, se
 * houver, o nesting) e materializam o arquivo que vai para a máquina — DXF de
 * corte e SVG da chapa —, sobem pro storage e devolvem `{ url }`.
 *
 * Separados de `blocks/cad.ts` de propósito: são os únicos do motor CAD que
 * tocam storage, e `lib/cad/*` é módulo puro (sem env, sem rede). Manter a
 * fronteira aqui é o que deixa a suíte rodar a geometria inteira sem credencial.
 *
 * Path sempre `${customerId}/${uuid}.<ext>` (sem nome do usuário → sem path
 * traversal), igual a `blocks/output-extra.ts`.
 */

/**
 * `lib/storage.ts` é carregado SOB DEMANDA. O registry de blocos é importado por
 * toda a suíte do motor; deixar o cliente de CDN fora do grafo de import estático
 * mantém os testes de geometria independentes de env de storage. Mesma precaução
 * de `blocks/collection.ts`.
 */
async function carregarStorage() {
	const { uploadToolOutput } = await import('../../lib/storage.js');
	return uploadToolOutput;
}

/* ─────────────────────────── Params compartilhados ─────────────────────────── */

function desserializa(v: unknown): unknown {
	if (v === '' || v === null) return undefined;
	if (typeof v !== 'string') return v;
	try {
		return JSON.parse(v);
	} catch {
		return v;
	}
}

function ehSketch(v: unknown): v is Sketch2D {
	const s = v as Partial<Sketch2D> | null | undefined;
	return (
		!!s && typeof s === 'object' && Array.isArray(s.parts) && s.units === 'mm'
	);
}

function ehNest(v: unknown): v is NestResult {
	const r = v as Partial<NestResult> | null | undefined;
	return !!r && typeof r === 'object' && Array.isArray(r.sheets);
}

// Anotação explícita: sem ela o zod infere a entrada do `preprocess` como
// `unknown` e o campo sai OPCIONAL no `z.infer`, embora a validação o exija.
const sketchParam: z.ZodType<Sketch2D, unknown> = z.preprocess(
	desserializa,
	z.custom<Sketch2D>(ehSketch, {
		message: 'esperado o desenho (sketch) produzido por um bloco cad.*',
	}),
);

const nestParam: z.ZodType<NestResult | undefined, unknown> = z.preprocess(
	desserializa,
	z
		.custom<NestResult>(ehNest, {
			message: 'esperado o resultado de um bloco cad.nest',
		})
		.optional(),
);

/* ───────────────────────── output.export_dxf_v2 ───────────────────────── */

const exportDxfV2Schema = z.object({
	sketch: sketchParam,
	nest: nestParam,
	folder: z.string().default('tool-output'),
});

/**
 * `output.export_dxf_v2` — DXF direto da IR, com camada por operação (CORTE
 * vermelho, GRAVACAO azul…) e unidade em mm.
 *
 * O `_v2` distingue do `output.export_dxf` antigo, que converte um SVG
 * rasterizado/vetorizado e por isso só sabe de contorno: não tem camada, não tem
 * arco nativo e não conhece o kerf. Este aqui sai do desenho paramétrico, então
 * o arco é ARC/bulge de verdade e a peça abre no tamanho certo.
 *
 * A chapa do nesting NÃO entra no arquivo (default de `sketchToDxf`): com ela
 * dentro, a máquina corta a borda da chapa — perde tempo, queima o batente e
 * pode soltar a peça no meio do job.
 */
export const outputExportDxfV2Block: ToolBlock<
	z.infer<typeof exportDxfV2Schema>
> = {
	id: 'output.export_dxf_v2',
	category: 'output',
	description:
		'Exporta o desenho CAD como DXF em mm, com uma camada por operação (corte, gravação, marcação). Devolve a URL pública do arquivo.',
	paramsSchema: exportDxfV2Schema,
	async run(ctx, params) {
		const dxf = sketchToDxf(params.sketch, params.nest);
		const uploadToolOutput = await carregarStorage();
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

/* ───────────────────────── output.export_svg_sheet ───────────────────────── */

const exportSvgSheetSchema = z.object({
	sketch: sketchParam,
	nest: nestParam,
	/**
	 * Qual chapa exportar (0-based). O SVG é UMA chapa por arquivo — sem este
	 * param, um job de 3 chapas exportaria a primeira três vezes.
	 */
	folha: z.coerce.number().int().min(0).max(200).default(0),
	folder: z.string().default('tool-output'),
});

/**
 * `output.export_svg_sheet` — a chapa como SVG em escala real (mm), pronta para
 * abrir no Inkscape/Illustrator ou importar no software da máquina que não lê
 * DXF. Sem `nest`, sai o layout de conferência (uma cópia de cada peça).
 */
export const outputExportSvgSheetBlock: ToolBlock<
	z.infer<typeof exportSvgSheetSchema>
> = {
	id: 'output.export_svg_sheet',
	category: 'output',
	description:
		'Exporta a chapa do desenho CAD como SVG em escala real (mm) e devolve a URL pública do arquivo.',
	paramsSchema: exportSvgSheetSchema,
	async run(ctx, params) {
		const svg = sketchToSvg(params.sketch, params.nest, {
			sheet: params.folha,
		});
		const uploadToolOutput = await carregarStorage();
		const path = `${ctx.customerId}/${crypto.randomUUID()}.svg`;
		const url = await uploadToolOutput(
			params.folder,
			Buffer.from(svg, 'utf8'),
			path,
			'image/svg+xml',
		);
		return { url };
	},
};

/** Blocos de saída do motor CAD, pra registro no index. */
export const outputCadBlocks: ToolBlock[] = [
	outputExportDxfV2Block,
	outputExportSvgSheetBlock,
];
