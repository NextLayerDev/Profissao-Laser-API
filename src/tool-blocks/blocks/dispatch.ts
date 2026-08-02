import { z } from 'zod';
import { ToolEngineError } from '../../lib/tool-errors.js';
import { blockRegistry } from '../registry.js';
import type { ToolBlock } from '../types.js';

/**
 * Blocos DISPATCHER — uma "mãe" cobre dezenas de filtros via UM dropdown.
 * Em vez de o pipeline fixar um bloco, o dispatcher recebe um `enum` (efeito /
 * algoritmo / operação) e delega pro bloco real já registrado no registry,
 * reusando 100% da lógica dos 99 blocos. A delegação acha o bloco por id e
 * chama `.run` com os params relevantes (o schema do alvo aplica os defaults e
 * descarta o que não usa).
 */

const img = z.instanceof(Buffer);

/** Roda um bloco do registry por id, com os params dados (defaults completam). */
async function delegate(
	ctx: { customerId: string; authHeader?: string; signal?: AbortSignal },
	blockId: string,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const target = blockRegistry.get(blockId);
	if (!target) {
		throw new ToolEngineError(400, `bloco indisponível: ${blockId}`);
	}
	const parsed = target.paramsSchema.safeParse(params);
	if (!parsed.success) {
		throw new ToolEngineError(
			400,
			`params inválidos p/ ${blockId}: ${parsed.error.issues[0]?.message ?? ''}`,
		);
	}
	return target.run(ctx, parsed.data);
}

/* ─────────────────────────── image.effect ───────────────────────────
 * Efeito de estilo escolhido por dropdown (Editor de Imagem). Mapeia o rótulo
 * PT → bloco stylize.* real. `intensity` é repassado (quem suporta usa). */
const EFFECT_MAP: Record<string, string> = {
	sepia: 'stylize.sepia',
	duotone: 'stylize.duotone',
	desenho: 'stylize.sketch',
	pontos: 'stylize.halftone',
	pixel: 'stylize.pixelate',
	vinheta: 'stylize.vignette',
	glitch: 'stylize.glitch',
	oleo: 'stylize.oilPaint',
	quadrinhos: 'stylize.comic',
	pontilhismo: 'stylize.stipple',
	brilho_suave: 'stylize.bloom',
	cross_process: 'stylize.crossProcess',
	split_toning: 'stylize.splitToning',
	vazamento_luz: 'stylize.lightLeak',
	nenhum: '',
};

const effectSchema = z.object({
	image: img,
	effect: z.string().default('nenhum'),
	intensity: z.coerce.number().min(0).max(1).default(1),
});

export const imageEffectBlock: ToolBlock<z.infer<typeof effectSchema>> = {
	id: 'image.effect',
	category: 'stylize',
	description:
		'Aplica um efeito artístico escolhido (sépia, duotone, desenho, óleo, quadrinhos…) — dispatcher dos blocos stylize.*.',
	paramsSchema: effectSchema,
	async run(ctx, params) {
		const target = EFFECT_MAP[params.effect] ?? '';
		// "nenhum" / desconhecido → passa a imagem direto (identidade).
		if (!target) {
			return {
				png: params.image,
				pngBase64: `data:image/png;base64,${params.image.toString('base64')}`,
			};
		}
		return delegate(ctx, target, {
			image: params.image,
			intensity: params.intensity,
		});
	},
};

/* ─────────────────────────── image.dither ───────────────────────────
 * Dithering escolhido por dropdown (Estúdio Laser). Mapeia algoritmo → bloco
 * dither.* real (reusa applyDithering por dentro). */
const DITHER_ALGOS = [
	'floydSteinberg',
	'atkinson',
	'jarvis',
	'stucki',
	'sierra',
	'sierra2',
	'sierraLite',
	'burkes',
	'bayer8',
	'bayer4',
	'halftone',
	'blueNoise',
	'errorDiffusion',
] as const;

const ditherSchema = z.object({
	image: img,
	algorithm: z.string().default('floydSteinberg'),
	threshold: z.coerce.number().min(0).max(255).default(128),
});

export const imageDitherBlock: ToolBlock<z.infer<typeof ditherSchema>> = {
	id: 'image.dither',
	category: 'dither',
	description:
		'Binariza P&B com o algoritmo de dithering escolhido — dispatcher dos blocos dither.*.',
	paramsSchema: ditherSchema,
	async run(ctx, params) {
		const algo = (DITHER_ALGOS as readonly string[]).includes(params.algorithm)
			? params.algorithm
			: 'floydSteinberg';
		return delegate(ctx, `dither.${algo}`, {
			image: params.image,
			threshold: params.threshold,
		});
	},
};

/* ──────────────────────────── ai.studio ─────────────────────────────
 * Operação de IA escolhida por dropdown (Estúdio de IA). */
const AI_MAP: Record<string, string> = {
	// "remover fundo" usa o removedor DETERMINÍSTICO (chroma-key, sem IA/custo);
	// colorir/restaurar seguem na IA (Gemini); ampliar é sharp (Lanczos).
	remover_fundo: 'image.removeBackground',
	colorir: 'ai.colorize',
	restaurar: 'ai.restoration',
	ampliar: 'image.upscale',
};

const aiStudioSchema = z.object({
	image: img,
	operation: z.string().default('remover_fundo'),
	factor: z.string().default('2'), // só p/ ampliar (image.upscale: enum '2'|'4'|'8'|'16')
});

export const aiStudioBlock: ToolBlock<z.infer<typeof aiStudioSchema>> = {
	id: 'ai.studio',
	category: 'ai',
	description:
		'IA de imagem: remover fundo, colorir, restaurar ou ampliar — dispatcher dos blocos de IA.',
	paramsSchema: aiStudioSchema,
	async run(ctx, params) {
		const target = AI_MAP[params.operation] ?? 'ai.backgroundRemoval';
		const extra = target === 'image.upscale' ? { factor: params.factor } : {};
		return delegate(ctx, target, { image: params.image, ...extra });
	},
};

/* ─────────────────────────── cad.generate ───────────────────────────
 * Modelo de CAD paramétrico escolhido por dropdown (uma tool-mãe cobre todos os
 * geradores). Cada gerador tem params PRÓPRIOS — e é por isso que este schema é
 * `passthrough`: o que a tela mandou passa inteiro, e o `safeParse` do bloco
 * filho é quem aplica default, converte string e descarta o que não é dele.
 * Com `strip` (o default do zod) todo param específico do gerador morreria aqui
 * e a churrasqueira sairia sempre no tamanho padrão. */
const CAD_MAP: Record<string, string> = {
	churrasqueira: 'cad.bbq',
	caixa: 'cad.box',
	trofeu: 'cad.trophy',
	medalha: 'cad.medal',
};

const cadGenerateSchema = z
	.object({ modelo: z.string().default('caixa') })
	.passthrough();

export const cadGenerateBlock: ToolBlock<z.infer<typeof cadGenerateSchema>> = {
	id: 'cad.generate',
	category: 'cad',
	description:
		'Gera o desenho paramétrico do modelo escolhido (caixa, churrasqueira…) — dispatcher dos geradores cad.*.',
	paramsSchema: cadGenerateSchema,
	async run(ctx, params) {
		const { modelo, ...resto } = params;
		const target = CAD_MAP[modelo];
		// Modelo desconhecido é ERRO, não identidade: um dispatcher de CAD não tem
		// "passa direto" (não existe desenho de entrada), e devolver vazio faria a
		// tool falhar lá na frente, no nesting, com uma mensagem que não ajuda.
		if (!target) {
			throw new ToolEngineError(
				400,
				`Modelo de CAD desconhecido: "${modelo}". Use um destes: ${Object.keys(CAD_MAP).join(', ')}.`,
			);
		}
		return delegate(ctx, target, resto);
	},
};

export const dispatchBlocks: ToolBlock[] = [
	imageEffectBlock,
	imageDitherBlock,
	aiStudioBlock,
	cadGenerateBlock,
];
