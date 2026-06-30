import sharp from 'sharp';
import { z } from 'zod';
import { generateToolImage } from '../../lib/image-gen.js';
import type { FxOutput, Raster } from '../lib/pixels.js';
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

/* ──────── Remover fundo HÍBRIDO: chroma-key (grátis) + IA p/ fundo complexo ──────── */

/** Estatísticas das bordas: cor mediana do fundo + desvio (uniformidade). */
function borderStats(r: Raster) {
	const { data, width, height } = r;
	const rs: number[] = [];
	const gs: number[] = [];
	const bs: number[] = [];
	const push = (idx: number) => {
		const o = idx * 4;
		if (data[o + 3] < 8) return; // ignora borda já transparente
		rs.push(data[o]);
		gs.push(data[o + 1]);
		bs.push(data[o + 2]);
	};
	for (let x = 0; x < width; x++) {
		push(x);
		push((height - 1) * width + x);
	}
	for (let y = 1; y < height - 1; y++) {
		push(y * width);
		push(y * width + width - 1);
	}
	const med = (a: number[]) => {
		a.sort((x, y) => x - y);
		return a[a.length >> 1];
	};
	const std = (a: number[], m: number) => {
		if (!a.length) return 0;
		let s = 0;
		for (const v of a) s += (v - m) * (v - m);
		return Math.sqrt(s / a.length);
	};
	const br = med([...rs]);
	const bgC = med([...gs]);
	const bb = med([...bs]);
	// "uniformidade" = maior desvio entre canais (fundo bagunçado → alto)
	const dev = Math.max(std(rs, br), std(gs, bgC), std(bs, bb));
	return { br, bgC, bb, dev, samples: rs.length };
}

/**
 * Chroma-key IN PLACE: flood-fill 4-conexo das bordas dentro de uma tolerância de
 * cor ao fundo (br,bgC,bb), tornando transparente só o fundo CONECTADO à borda —
 * áreas da mesma cor DENTRO do sujeito ficam intactas. Feather na borda. Devolve
 * o nº de pixels marcados como fundo (0 se não aplicou).
 */
function chromaKeyAlpha(
	r: Raster,
	br: number,
	bgC: number,
	bb: number,
	tolerance: number,
	feather: number,
): number {
	const { data, width, height } = r;
	const n = width * height;
	const MAXD = Math.sqrt(3) * 255;
	const hard = tolerance * MAXD;
	const soft = Math.min(MAXD, hard * (1 + feather));
	const dist = (idx: number) => {
		const o = idx * 4;
		const dr = data[o] - br;
		const dg = data[o + 1] - bgC;
		const db = data[o + 2] - bb;
		return Math.sqrt(dr * dr + dg * dg + db * db);
	};
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
	if (marked < 32 || marked > n * 0.985) return 0; // vazou tudo / nada → não aplica
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
	return marked;
}

/**
 * Removedor de fundo HÍBRIDO:
 *  • Fundo UNIFORME (foto/logo em cor lisa) → chroma-key determinístico, grátis e
 *    instantâneo (flood-fill das bordas + feather). Preserva o sujeito.
 *  • Fundo COMPLEXO (pessoa em cena bagunçada) → cai pra IA: o Gemini isola o
 *    sujeito sobre BRANCO PURO e o chroma-key tira o branco (uniforme) → recorte
 *    transparente inteligente. Sem chave nova (reusa a IA já integrada).
 *  • Se a IA não estiver disponível, faz o melhor esforço com o chroma-key.
 */
export const removeBgBlock = block(
	'image.removeBackground',
	'Remove o fundo: chroma-key p/ fundo uniforme + IA p/ fundo complexo (híbrido).',
	{
		tolerance: z.coerce.number().min(0.02).max(0.6).default(0.16),
		feather: z.coerce.number().min(0).max(1).default(0.6),
	},
	async (p) => {
		const r = await loadRaster(p.image);
		const n = r.width * r.height;
		if (n < 16) return fxFromRaster(r);
		const st = borderStats(r);

		// 1) Fundo uniforme o bastante → chroma-key direto (grátis).
		const COMPLEX_DEV = 40; // desvio das bordas acima disso = fundo complexo
		if (st.samples >= 8 && st.dev <= COMPLEX_DEV) {
			const marked = chromaKeyAlpha(
				r,
				st.br,
				st.bgC,
				st.bb,
				p.tolerance,
				p.feather,
			);
			if (marked > 0) return fxFromRaster(r); // chroma-key resolveu
		}

		// 2) Fundo complexo (ou chroma-key não resolveu) → IA isola em branco e
		//    o chroma-key tira o branco. Reusa o Gemini já integrado.
		try {
			const gen = await generateToolImage(
				'Recorte com precisão o sujeito principal (pessoa/objeto) e coloque-o SOZINHO sobre fundo BRANCO PURO (#FFFFFF), totalmente liso, sem sombra. Preserve todas as bordas, cabelo e detalhes; não altere o sujeito.',
				[p.image],
			);
			const rg = await loadRaster(gen.png);
			// branco é uniforme → chroma-key com tolerância apertada tira o fundo.
			chromaKeyAlpha(rg, 255, 255, 255, 0.1, 0.5);
			return fxFromRaster(rg);
		} catch {
			// IA indisponível (sem chave/erro) → melhor esforço com chroma-key.
			const r2 = await loadRaster(p.image);
			const s2 = borderStats(r2);
			chromaKeyAlpha(r2, s2.br, s2.bgC, s2.bb, p.tolerance, p.feather);
			return fxFromRaster(r2);
		}
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
