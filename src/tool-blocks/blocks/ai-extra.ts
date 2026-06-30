import sharp from 'sharp';
import { z } from 'zod';
import { generateToolImage } from '../../lib/image-gen.js';
import type { FxOutput } from '../lib/pixels.js';
import { fxFromRaster, fxSharp, loadRaster } from '../lib/pixels.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos de IA EXTRA (categoria `ai`) — port do grupo "AI" do ImagR. Embrulham
 * a geração de imagem multimodal (`lib/image-gen` → Gemini Image via OpenRouter,
 * NÃO o modelo exato do ImagR) e operações de re-amostragem. Saída padrão de
 * filtro: `{ png, pngBase64 }`. `image.upscale` é o único que NÃO usa IA — só
 * redimensiona com Lanczos (sharp nativo).
 */

const img = z.instanceof(Buffer);

/** Açúcar: define um bloco de IA com schema {image, ...P}. Mesma assinatura do adjust.ts. */
function block<P extends z.ZodRawShape>(
	id: string,
	description: string,
	shape: P,
	run: (
		params: z.infer<z.ZodObject<P & { image: typeof img }>>,
	) => Promise<FxOutput>,
): ToolBlock {
	const schema = z.object({ image: img, ...shape });
	return {
		id,
		category: 'ai',
		description,
		paramsSchema: schema as z.ZodType<unknown>,
		run: (_ctx, params) =>
			run(params as z.infer<z.ZodObject<P & { image: typeof img }>>),
	} as ToolBlock;
}

/* ───────────────────────────── Upscale (não-IA) ───────────────────────────── */

export const upscaleBlock = block(
	'image.upscale',
	'Amplia 2/4/8/16× com reamostragem Lanczos3 (não é IA).',
	{ factor: z.enum(['2', '4', '8', '16']).default('2').transform(Number) },
	async (p) => {
		// Lê dimensões reais e multiplica pelo fator — mas CLAMPA o fator efetivo
		// pra saída não estourar (~40MP / 10000px por lado). Sem isso, foto grande
		// + 16× explode ("Input image exceeds pixel limit") e o cliente toma erro.
		const meta = await sharp(p.image).metadata();
		const w = meta.width ?? 0;
		const h = meta.height ?? 0;
		const MAX_SIDE = 10_000;
		const MAX_MP = 40_000_000;
		const capBySide = Math.min(
			MAX_SIDE / Math.max(w, 1),
			MAX_SIDE / Math.max(h, 1),
		);
		const capByMp = Math.sqrt(MAX_MP / Math.max(w * h, 1));
		const eff = Math.max(1, Math.min(p.factor, capBySide, capByMp));
		const tw = Math.max(1, Math.round(w * eff));
		const th = Math.max(1, Math.round(h * eff));
		return fxSharp(p.image, (s) => s.resize(tw, th, { kernel: 'lanczos3' }));
	},
);

/* ─────────────────── Remover fundo (chroma-key, SEM IA) ─────────────────── */

/**
 * Removedor de fundo DETERMINÍSTICO (sem IA): estima a cor do fundo pela MEDIANA
 * das bordas e faz flood-fill 4-conexo a partir das bordas, tornando transparente
 * só o fundo CONECTADO à borda dentro de uma tolerância de cor — áreas da mesma
 * cor DENTRO do sujeito ficam intactas (não são alcançadas). Borda recebe FEATHER
 * (alpha parcial) pra um recorte suave. Funciona muito bem em foto/logo sobre
 * fundo uniforme (caso típico do laser). Instantâneo e grátis (CPU).
 */
export const removeBgBlock = block(
	'image.removeBackground',
	'Remove o fundo por chroma-key (flood-fill das bordas + feather) — sem IA.',
	{
		tolerance: z.coerce.number().min(0.02).max(0.6).default(0.16),
		feather: z.coerce.number().min(0).max(1).default(0.6),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const { data, width, height } = r;
		const n = width * height;
		if (n < 16) return fxFromRaster(r);

		// 1) cor do fundo = mediana por canal das bordas OPACAS.
		const rs: number[] = [];
		const gs: number[] = [];
		const bs: number[] = [];
		const sample = (idx: number) => {
			const o = idx * 4;
			if (data[o + 3] < 8) return; // ignora borda já transparente
			rs.push(data[o]);
			gs.push(data[o + 1]);
			bs.push(data[o + 2]);
		};
		for (let x = 0; x < width; x++) {
			sample(x);
			sample((height - 1) * width + x);
		}
		for (let y = 1; y < height - 1; y++) {
			sample(y * width);
			sample(y * width + width - 1);
		}
		if (rs.length < 8) return fxFromRaster(r); // borda quase toda transparente
		const med = (a: number[]) => {
			a.sort((x, y) => x - y);
			return a[a.length >> 1];
		};
		const br = med(rs);
		const bgC = med(gs);
		const bb = med(bs);

		const MAXD = Math.sqrt(3) * 255;
		const hard = p.tolerance * MAXD;
		const soft = Math.min(MAXD, hard * (1 + p.feather)); // banda de feather
		const dist = (idx: number) => {
			const o = idx * 4;
			const dr = data[o] - br;
			const dg = data[o + 1] - bgC;
			const db = data[o + 2] - bb;
			return Math.sqrt(dr * dr + dg * dg + db * db);
		};

		// 2) flood-fill 4-conexo das bordas dentro do limiar duro.
		const isBg = new Uint8Array(n);
		const stack = new Int32Array(n);
		let sp = 0;
		let marked = 0;
		const seed = (idx: number) => {
			if (isBg[idx] === 0 && dist(idx) <= hard) {
				isBg[idx] = 1;
				stack[sp++] = idx;
				marked++;
			}
		};
		for (let x = 0; x < width; x++) {
			seed(x);
			seed((height - 1) * width + x);
		}
		for (let y = 1; y < height - 1; y++) {
			seed(y * width);
			seed(y * width + width - 1);
		}
		while (sp > 0) {
			const idx = stack[--sp];
			const x = idx % width;
			const y = (idx - x) / width;
			if (x > 0) seed(idx - 1);
			if (x < width - 1) seed(idx + 1);
			if (y > 0) seed(idx - width);
			if (y < height - 1) seed(idx + width);
		}
		// Segurança: vazou pro sujeito inteiro (>97%) ou não achou fundo → não mexe.
		if (marked < 32 || marked > n * 0.97) return fxFromRaster(r);

		// 3) aplica: fundo → transparente; borda do sujeito → feather por distância.
		for (let idx = 0; idx < n; idx++) if (isBg[idx]) data[idx * 4 + 3] = 0;
		if (soft > hard) {
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					const idx = y * width + x;
					if (isBg[idx]) continue;
					const touches =
						(x > 0 && isBg[idx - 1]) ||
						(x < width - 1 && isBg[idx + 1]) ||
						(y > 0 && isBg[idx - width]) ||
						(y < height - 1 && isBg[idx + width]);
					if (!touches) continue;
					const d = dist(idx);
					if (d < soft) {
						const a = (d - hard) / (soft - hard);
						data[idx * 4 + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
					}
				}
			}
		}
		return fxFromRaster(r);
	},
);

/* ───────────────────────────── IA (Gemini Image) ───────────────────────────── */

export const backgroundRemovalBlock = block(
	'ai.backgroundRemoval',
	'Remove o fundo deixando o objeto sobre fundo branco (IA — Gemini Image).',
	{},
	(p) =>
		// Usa Gemini Image (não o modelo exato do ImagR).
		generateToolImage(
			'Remova completamente o fundo desta imagem, deixando o objeto principal sobre fundo BRANCO sólido. Não altere o objeto.',
			[p.image],
		),
);

export const colorizeBlock = block(
	'ai.colorize',
	'Coloriza foto P&B com cores realistas e naturais (IA — Gemini Image).',
	{},
	(p) =>
		// Usa Gemini Image (não o modelo exato do ImagR).
		generateToolImage(
			'Colorize esta foto em preto e branco com cores realistas e naturais, preservando todos os detalhes.',
			[p.image],
		),
);

export const restorationBlock = block(
	'ai.restoration',
	'Restaura foto antiga/danificada: remove riscos/ruído e recupera nitidez (IA — Gemini Image).',
	{},
	(p) =>
		// Usa Gemini Image (não o modelo exato do ImagR).
		generateToolImage(
			'Restaure e melhore esta foto antiga/danificada: remova riscos e ruído, recupere nitidez e detalhes, mantendo a aparência original.',
			[p.image],
		),
);

/** Todos os blocos de IA extra, pra registro no index. */
export const aiExtraBlocks: ToolBlock[] = [
	upscaleBlock,
	removeBgBlock,
	backgroundRemovalBlock,
	colorizeBlock,
	restorationBlock,
];
