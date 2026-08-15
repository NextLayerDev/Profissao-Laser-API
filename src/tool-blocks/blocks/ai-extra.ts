import sharp from 'sharp';
import { z } from 'zod';
import { generateToolImage } from '../../lib/image-gen.js';
import type { FxOutput } from '../lib/pixels.js';
import {
	borderStats,
	chromaKeyAlpha,
	fxFromRaster,
	fxSharp,
	loadRaster,
} from '../lib/pixels.js';
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

/** Lado máximo da saída ampliada. */
const MAX_SIDE = 10_000;
/** Megapixels máximos da saída ampliada (~40 MP). */
export const MAX_MP_AMPLIAR = 40_000_000;

/**
 * O fator que a ampliação VAI usar de verdade, dado o tamanho de entrada.
 *
 * Extraída do bloco (era um cálculo inline) porque virou informação que a TELA
 * precisa: nos Ajustes o aluno pede "4×" e pode receber 1,55× por causa do
 * teto — e receber menos do que se pediu sem ninguém dizer nada é o tipo de
 * silêncio que faz o aluno achar que o botão não funcionou. Quem chama usa esta
 * mesma função para ANUNCIAR o número antes/depois, sem duplicar a regra.
 *
 * Pura: só aritmética sobre dimensões. Nunca devolve menos que 1 (encolher no
 * "ampliar" seria pior que não ampliar).
 */
export function escalaEfetiva(
	width: number,
	height: number,
	factor: number,
	opts: { maxSide?: number; maxMp?: number } = {},
): number {
	const maxSide = opts.maxSide ?? MAX_SIDE;
	const maxMp = opts.maxMp ?? MAX_MP_AMPLIAR;
	const w = Math.max(width, 0);
	const h = Math.max(height, 0);
	const capBySide = Math.min(
		maxSide / Math.max(w, 1),
		maxSide / Math.max(h, 1),
	);
	const capByMp = Math.sqrt(maxMp / Math.max(w * h, 1));
	return Math.max(1, Math.min(factor, capBySide, capByMp));
}

export const upscaleBlock = block(
	'image.upscale',
	'Amplia 2/4/8/16× com reamostragem Lanczos3 (não é IA).',
	{
		factor: z.enum(['2', '4', '8', '16']).default('2').transform(Number),
		/**
		 * Teto de megapixels da SAÍDA, por chamada. Ausente = os 40 MP de sempre
		 * (nenhuma tool publicada muda de comportamento). Existe para o caminho
		 * GRÁTIS do preview poder ser mais apertado que o cobrado: lá a imagem
		 * volta inteira em base64 dentro do JSON, e 40 MP viram dezenas de MB
		 * numa rota sem cobrança e sem limite de uso.
		 */
		max_mp: z.coerce.number().min(1_000_000).max(MAX_MP_AMPLIAR).optional(),
	},
	async (p) => {
		// Lê dimensões reais e multiplica pelo fator — mas CLAMPA o fator efetivo
		// pra saída não estourar. Sem isso, foto grande + 16× explode ("Input
		// image exceeds pixel limit") e o cliente toma erro.
		const meta = await sharp(p.image).metadata();
		const w = meta.width ?? 0;
		const h = meta.height ?? 0;
		const eff = escalaEfetiva(w, h, p.factor, { maxMp: p.max_mp });
		const tw = Math.max(1, Math.round(w * eff));
		const th = Math.max(1, Math.round(h * eff));
		return fxSharp(p.image, (s) => s.resize(tw, th, { kernel: 'lanczos3' }));
	},
);

/* ──────── Remover fundo HÍBRIDO: chroma-key (grátis) + IA p/ fundo complexo ──────── */
// `borderStats`/`chromaKeyAlpha` moraram aqui e viraram exports compartilhados
// em `../lib/pixels.js` — também usados por `vectorize-color.ts`.

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
