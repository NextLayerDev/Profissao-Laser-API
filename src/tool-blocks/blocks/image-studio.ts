import sharp from 'sharp';
import { z } from 'zod';
import { generateToolImage, resolveImageModel } from '../../lib/image-gen.js';
import { ToolEngineError } from '../../lib/tool-errors.js';
import { EDITOR_MODEL, editorAiService } from '../../services/editor-ai.js';
import type { ToolBlock } from '../types.js';
import { escalaEfetiva, removeBgBlock, upscaleBlock } from './ai-extra.js';
import { makeTileable } from './tile.js';

/**
 * `ai.image_studio` — o motor do ESTÚDIO DE IMAGENS.
 *
 * Diferença para os Prompts Mágicos: lá o aluno escolhe um prompt do banco do
 * admin e recebe uma imagem; aqui ele escreve o que quiser, itera em cima do
 * próprio resultado (variação) e leva a imagem para a Vetorização. Um dropdown
 * `mode` cobre os sete caminhos, e cada um delega para código que já roda em
 * produção — nada aqui reimplementa geração, inpainting, upscale ou recorte.
 *
 * POR QUE NÃO ESTENDER `ai.studio`: aquele bloco exige `image` obrigatória no
 * schema (não faz texto→imagem) e serve as três tools-mãe do ImagR JÁ
 * PUBLICADAS em produção. Mexer no schema dele para caber texto→imagem
 * arriscaria três tools pagas por conveniência de arquivo. Bloco novo.
 */

/* ─────────────────────────── formatos ─────────────────────────── */

/**
 * Formatos de saída. Lado longo 1536 px (exceto o quadrado, que fica em 1024
 * por ser o formato mais usado e o mais barato de gerar).
 *
 * Cinco dos sete são múltiplos de 64, como o encoder do modelo prefere. 16:9 e
 * 9:16 param no 32 (864 = 13,5 × 64) porque proporção EXATA e lado longo 1536
 * são incompatíveis com 64 nesse formato — e entre uma proporção arredondada e
 * um múltiplo de 64, a proporção ganha: 16:9 que não é 16:9 vira barra preta no
 * vídeo do aluno, enquanto múltiplo de 32 nenhum modelo reclama.
 */
export const STUDIO_ASPECTS = {
	'1:1': { width: 1024, height: 1024 },
	'4:3': { width: 1536, height: 1152 },
	'3:4': { width: 1152, height: 1536 },
	'16:9': { width: 1536, height: 864 },
	'9:16': { width: 864, height: 1536 },
	'3:2': { width: 1536, height: 1024 },
	'2:3': { width: 1024, height: 1536 },
} as const;

export type StudioAspect = keyof typeof STUDIO_ASPECTS;

const ASPECT_KEYS = Object.keys(STUDIO_ASPECTS) as [
	StudioAspect,
	...StudioAspect[],
];

/* ─────────────────────────── modos ─────────────────────────── */

export const STUDIO_MODES = [
	'texto_imagem',
	'variacao',
	'editar_mascara',
	'ampliar',
	'remover_fundo',
	'textura',
	'vetorizavel',
] as const;

export type StudioMode = (typeof STUDIO_MODES)[number];

/**
 * Teto de megapixels da ampliação quando ela roda no PREVIEW (rota grátis).
 * Ver a caixa no `case 'ampliar'`.
 */
export const MAX_MP_AMPLIAR_PREVIEW = 24_000_000;

/**
 * OS FATORES DE AMPLIAÇÃO — uma lista só, e exportada porque a TELA precisa
 * dela.
 *
 * A tela do Ateliê oferecia 2×, 3× e 4× apoiada num comentário do seed que
 * dizia que o bloco aceitava "'2', '3', '4'". Não aceita: o `image.upscale`
 * valida `'2'|'4'|'8'|'16'`, e o 3× dava erro em 100% dos cliques — com uma
 * mensagem que ainda mandava o aluno "tentar de novo em instantes".
 *
 * `8` e `16` existem no bloco cru mas ficam FORA daqui de propósito: no
 * preview (a rota por onde o ampliar do Ateliê passa) o teto de
 * `MAX_MP_AMPLIAR_PREVIEW` clampa a escala, e 8× sobre uma arte de 1024²
 * entregaria ~4,8× — um botão que promete oito e devolve cinco. Só entra o que
 * o Ateliê consegue honrar.
 */
export const FATORES_DE_AMPLIACAO = ['2', '4'] as const;

/**
 * Multiplicador de custo por modo, sobre o `vox_cost` da tool.
 *
 * `ampliar` é Lanczos puro (sharp, sem rede, sem IA) — cobrar por ele seria
 * cobrar por um `resize`. Grátis de verdade.
 *
 * `remover_fundo` cai no bloco HÍBRIDO: fundo liso resolve no chroma-key
 * (grátis, instantâneo) e fundo bagunçado chama o Gemini. Quem decide é o
 * desvio das bordas passar de 40 — e nem o aluno nem a tela têm como saber
 * disso ANTES de rodar. Cobrar "às vezes" produziria a pior experiência
 * possível (o preço muda sem explicação visível), então cobra sempre, barato:
 * metade. Na média a conta fecha e o preço é previsível.
 *
 * O front lê o mesmo mapa de `definition.billing.mode_cost` para mostrar o
 * custo antes de rodar; aqui ele volta no output para a tela poder dizer
 * "custou 0,5 voxxy" com o número que o motor de fato usou.
 */
export const STUDIO_MODE_COST: Record<StudioMode, number> = {
	texto_imagem: 1,
	variacao: 1,
	editar_mascara: 1,
	textura: 1,
	vetorizavel: 1,
	ampliar: 0,
	remover_fundo: 0.5,
};

/**
 * Instrução fixa do modo `vetorizavel`. É CONSTANTE DO BLOCO, não campo do
 * admin: o contrato do modo ("sai preto e branco puro, vetorizável") é o que a
 * tela promete e o que a ponte com a Vetorização assume. Deixar isso editável
 * transformaria uma garantia em preferência.
 */
export const VECTOR_LEAD =
	'Ilustração vetorial de traço. PRETO PURO #000000 sobre BRANCO PURO #FFFFFF. Sem cinza, sem gradiente, sem sombreamento, sem textura, sem meio-tom. Linhas fechadas e contínuas, espessura mínima equivalente a 2 px. Silhueta legível em uma única cor.';

/**
 * Instrução fixa do modo `textura`. Pede o que faz o `makeTileable` funcionar:
 * iluminação chapada e densidade constante. Sombra projetada e vinheta são o
 * que denuncia a emenda depois do blend — a faixa disfarça diferença de
 * TEXTURA, não diferença de LUZ.
 */
export const TEXTURE_LEAD =
	'Textura contínua vista de frente, iluminação chapada e uniforme, sem sombra projetada, sem vinheta, sem brilho concentrado. Densidade, escala e cor constantes em todo o quadro. Sem objeto em destaque, sem moldura, sem borda, sem texto — só o material preenchendo 100% da imagem.';

/* ─────────────────────────── schema ─────────────────────────── */

// O motor injeta `null` num input de imagem não preenchido (`coerceInputs`).
// Só `z.instanceof(Buffer)` rejeitaria o modo texto→imagem, que não tem imagem.
const optionalImage = z.union([z.instanceof(Buffer), z.null(), z.undefined()]);

const studioSchema = z
	.object({
		mode: z.enum(STUDIO_MODES).default('texto_imagem'),
		prompt: z.string().max(8_000).optional(),
		image: optionalImage,
		image2: optionalImage,
		image3: optionalImage,
		/** PNG onde BRANCO = repintar, PRETO = preservar (contrato do editor-ai). */
		mask: optionalImage,
		/** Cauda de estilo, vinda da coleção `estilos` (biblioteca do admin). */
		style_suffix: z.string().max(2_000).optional(),
		/** System prompt do estilo escolhido. SUBSTITUI o da tool (ver `run`). */
		style_system: z.string().max(4_000).optional(),
		aspect: z.enum(ASPECT_KEYS).default('1:1'),
		/** Só `ampliar`. String porque `image.upscale` valida um enum de strings. */
		/**
		 * Os fatores que o `image.upscale` REALMENTE aceita — a mesma lista dele,
		 * não uma paralela.
		 *
		 * Era `z.string()`, e o buraco não era teórico: a tela oferecia 2×, 3× e 4×,
		 * o `upscaleBlock` valida `'2'|'4'|'8'|'16'`, e o `.parse()` lá embaixo
		 * LANÇA dentro do `run`. A `ZodError` escapava da proteção do motor (que
		 * vira 400 em português) e chegava ao aluno como 500 com o JSON do Zod
		 * dentro. Um terço dos cliques no único ajuste grátis, sempre.
		 *
		 * Validando aqui, o motor recusa ANTES de rodar e a mensagem é de gente.
		 */
		factor: z.enum(FATORES_DE_AMPLIACAO).default('2'),
		/** Override do modelo OpenRouter (injetado de `definition.model`). */
		model: z.string().min(1).max(200).optional(),
		/** Override do system prompt (injetado de `definition.system_prompt`). */
		system_prompt: z.string().min(1).optional(),
		/**
		 * "Sem intermediação" (injetado de `definition.raw_prompt`).
		 *
		 * Estava FALTANDO, e o silêncio era o problema: `tool-run` injeta
		 * `params.raw_prompt` neste bloco (ele está no `IMAGE_GEN_BLOCKS`), o
		 * `z.object` faz `strip` do que não declara, e a chave morria aqui. O
		 * admin ligava o interruptor na Fábrica, o motor obedecia, o bloco
		 * descartava — sem erro, sem log, sem efeito.
		 *
		 * OBS: ligar isto DESCARTA o `style_system` e o `system_prompt` (é
		 * exatamente o que "sem intermediação" quer dizer). O formato real
		 * (`/v1/images`) NÃO depende mais disto — ver `formatoReal` no `run`.
		 *
		 * `z.boolean()` puro, igual ao irmão `ai.generate_image`: o motor injeta
		 * o booleano de verdade, e `z.coerce.boolean()` seria armadilha
		 * (`Boolean('false') === true` ligaria o modo com o valor DESLIGADO).
		 */
		raw_prompt: z.boolean().optional(),
		/** Dimensão exata; se vier, vence o `aspect`. */
		width: z.coerce.number().int().min(64).max(4096).optional(),
		height: z.coerce.number().int().min(64).max(4096).optional(),
	})
	.superRefine((p, ctx) => {
		const needsPrompt: StudioMode[] = [
			'texto_imagem',
			'variacao',
			'editar_mascara',
			'textura',
			'vetorizavel',
		];
		if (needsPrompt.includes(p.mode) && !p.prompt?.trim()) {
			ctx.addIssue({
				code: 'custom',
				path: ['prompt'],
				message: 'Descreva o que você quer gerar.',
			});
		}
		const refs = [p.image, p.image2, p.image3].filter((b) =>
			Buffer.isBuffer(b),
		);
		if (p.mode === 'variacao' && refs.length === 0) {
			ctx.addIssue({
				code: 'custom',
				path: ['image'],
				message: 'Escolha ao menos uma imagem para variar.',
			});
		}
		const needsImage: StudioMode[] = [
			'editar_mascara',
			'ampliar',
			'remover_fundo',
		];
		if (needsImage.includes(p.mode) && !Buffer.isBuffer(p.image)) {
			ctx.addIssue({
				code: 'custom',
				path: ['image'],
				message: 'Envie uma imagem.',
			});
		}
	});

export type StudioParams = z.infer<typeof studioSchema>;

/* ─────────────────────────── helpers ─────────────────────────── */

/** Dimensão pedida: `width`/`height` explícitos vencem; senão, o `aspect`. */
function resolveSize(p: StudioParams): { width: number; height: number } {
	if (p.width && p.height) return { width: p.width, height: p.height };
	return STUDIO_ASPECTS[p.aspect];
}

/** `[lead do modo] + [prompt do aluno] + [cauda do estilo]`, sem linhas vazias. */
function composePrompt(
	lead: string | null,
	prompt: string,
	styleSuffix?: string,
): string {
	return [lead, prompt, styleSuffix?.trim()].filter(Boolean).join('\n\n');
}

/** Data URL / base64 cru → Buffer PNG normalizado. */
async function toPng(base64OrDataUrl: string): Promise<Buffer> {
	const raw = base64OrDataUrl.includes(',')
		? base64OrDataUrl.slice(base64OrDataUrl.indexOf(',') + 1)
		: base64OrDataUrl;
	const buf = Buffer.from(raw, 'base64');
	if (buf.byteLength === 0) {
		throw new ToolEngineError(502, 'A IA devolveu uma imagem vazia.');
	}
	return sharp(buf).png().toBuffer();
}

/* ─────────────────────────── bloco ─────────────────────────── */

export const imageStudioBlock: ToolBlock<StudioParams> = {
	id: 'ai.image_studio',
	category: 'ai',
	description:
		'Estúdio de imagens: texto→imagem, variação, edição com máscara, ampliar, remover fundo, textura repetível e arte vetorizável.',
	paramsSchema: studioSchema,
	async run(ctx, p) {
		const refs = [p.image, p.image2, p.image3].filter((b): b is Buffer =>
			Buffer.isBuffer(b),
		);
		const { width, height } = resolveSize(p);
		const prompt = (p.prompt ?? '').trim();

		// Precedência do system prompt: o ESTILO escolhido nesta geração vence o
		// system prompt da tool, que é só o default do admin. Específico ganha de
		// genérico — e o estilo é a escolha explícita de quem está gerando.
		// Ausentes os dois, `generateToolImage` cai no prompt laser padrão.
		const systemPromptOverride =
			p.style_system?.trim() || p.system_prompt?.trim() || undefined;

		/**
		 * `fit: 'cover'` (corta) em vez do legado `'fill'` (estica): no Estúdio o
		 * formato é escolha do aluno, e o modelo devolve quadrado com frequência
		 * mesmo com o sufixo de FORMATO no prompt. Com `fill`, um pedido 16:9
		 * chegaria esticado — rosto oval, círculo virando elipse. Corte é
		 * recuperável (dá pra gerar de novo); distorção passa despercebida até
		 * estar gravada na peça.
		 *
		 * `formatoReal: true` — O CONSERTO DO 9:16 QUE SAÍA QUADRADO.
		 *
		 * O aluno escolhe o formato num seletor (`STUDIO_ASPECTS`), então aqui a
		 * proporção não é preferência: é pedido explícito. Só que ela viajava
		 * apenas como FRASE no fim do prompt, porque a rota `/v1/images` — a única
		 * que aceita `aspect_ratio` de verdade — estava amarrada ao `rawPrompt`,
		 * que este bloco NUNCA passou. Medido nos bytes (2026-08-09):
		 *   • num modelo GPT, o 9:16 voltava 1024×1024 e o `cover` amputava 43,75%
		 *     da arte — é este o "9:16 que sai quadrado";
		 *   • num Gemini voltava 768×1376 e o resize INVENTAVA 27% dos pixels
		 *     finais pra chegar aos 864×1536.
		 * Com o formato como parâmetro, o Gemini devolve cobrindo o alvo (o resize
		 * vira downscale, zero pixel inventado) e o GPT — que não expõe proporção
		 * em API nenhuma — ao menos sai de 1:1 pra 2:3, com o `cover` aparando
		 * 15,63% em vez de 43,75%.
		 *
		 * O system prompt NÃO se perde na troca de rota: `generateToolImage` dobra
		 * o system dentro do `prompt` quando não é `rawPrompt` — é o que mantém o
		 * `style_system` do estilo escolhido valendo aqui.
		 */
		const genOpts = {
			model: p.model,
			systemPromptOverride,
			width,
			height,
			formatoReal: true,
			rawPrompt: p.raw_prompt === true,
			fit: 'cover' as const,
		};

		/**
		 * Saída comum dos sete modos. Tipo explícito (e não `GenImageResult &
		 * Record<string, unknown>`) porque interface não ganha index signature
		 * implícita em TS — a interseção não compila.
		 */
		let out: {
			png: Buffer;
			pngBase64: string;
			vectorReady?: boolean;
			tileable?: boolean;
		};

		/**
		 * Modelo que DE FATO rodou, para a galeria arquivar a verdade.
		 * `ampliar` não usa nenhum (Lanczos). `remover_fundo` fica em null de
		 * propósito: ele resolve no chroma-key na maioria das vezes e só cai na IA
		 * em fundo complexo — registrar um modelo em toda remoção diria que houve
		 * geração onde quase sempre não houve.
		 */
		let usedModel: string | null = null;

		/**
		 * Só o modo `ampliar` preenche. `null` nos outros porque "escala" não
		 * significa nada numa geração — e um `1` ali seria lido pela tela como
		 * "ampliei uma vez", que é falso.
		 */
		let escalaPedida: number | null = null;
		let escalaReal: number | null = null;

		switch (p.mode) {
			case 'texto_imagem':
			case 'variacao': {
				usedModel = resolveImageModel(p.model);
				// Variação = a MESMA chamada com as referências preenchidas. O
				// `image-gen` já põe as refs primeiro e o texto por último, que é o
				// que faz o pedido do aluno prevalecer sobre o estilo da referência.
				out = await generateToolImage(
					composePrompt(null, prompt, p.style_suffix),
					refs,
					ctx.signal,
					genOpts,
				);
				break;
			}

			case 'textura': {
				usedModel = resolveImageModel(p.model);
				const gen = await generateToolImage(
					composePrompt(TEXTURE_LEAD, prompt, p.style_suffix),
					refs,
					ctx.signal,
					genOpts,
				);
				// O prompt PEDE textura contínua; o `makeTileable` GARANTE. Modelo
				// nenhum fecha as bordas sozinho — ver o cabeçalho de `tile.ts`.
				const png = await makeTileable(gen.png);
				out = {
					png,
					pngBase64: `data:image/png;base64,${png.toString('base64')}`,
					tileable: true,
				};
				break;
			}

			case 'vetorizavel': {
				usedModel = resolveImageModel(p.model);
				const gen = await generateToolImage(
					composePrompt(VECTOR_LEAD, prompt, p.style_suffix),
					refs,
					ctx.signal,
					genOpts,
				);
				/**
				 * É ESTE PÓS DETERMINÍSTICO QUE TORNA O MODO CONFIÁVEL, NÃO O PROMPT.
				 * O modelo desobedece o "preto puro sobre branco puro" com frequência
				 * — devolve cinza de anti-aliasing, um leve gradiente de fundo, uma
				 * sombra discreta. Qualquer um desses vira ruído no Potrace e sujeira
				 * no corte. `grayscale → normalize → threshold(128)` fecha a porta:
				 * a saída é binária por construção, dê no que der na geração.
				 * `flatten` sobre branco antes porque, se o modelo devolver PNG com
				 * alfa, o transparente precisa virar FUNDO (branco) e não traço.
				 */
				const png = await sharp(gen.png)
					.flatten({ background: '#ffffff' })
					.grayscale()
					.normalize()
					.threshold(128)
					.png()
					.toBuffer();
				out = {
					png,
					pngBase64: `data:image/png;base64,${png.toString('base64')}`,
					vectorReady: true,
				};
				break;
			}

			case 'editar_mascara': {
				// FIXO, e não `p.model`: o `editor-ai` roda num modelo próprio. A
				// escolha de modelo que o admin faz na Fábrica não alcança este modo.
				usedModel = EDITOR_MODEL;
				// Inpainting já implementado em `editor-ai` (branco na máscara =
				// repintar). Sem máscara vira edição global da imagem inteira — o
				// mesmo serviço trata os dois casos, então não custa proibir.
				const image = p.image as Buffer;
				let imageBase64: string;
				try {
					const res = await editorAiService.generateOrEdit({
						mode: 'edit',
						prompt: composePrompt(null, prompt, p.style_suffix),
						image: image.toString('base64'),
						...(Buffer.isBuffer(p.mask)
							? { mask: p.mask.toString('base64') }
							: {}),
					});
					imageBase64 = res.imageBase64;
				} catch (err) {
					// `editor-ai` lança `Error` cru; sem embrulhar, o controller
					// devolveria 500 genérico em vez de 502 com a causa em PT-BR
					// (o refund acontece nos dois casos).
					const msg = err instanceof Error ? err.message : 'falha';
					throw new ToolEngineError(502, `Não consegui editar: ${msg}`);
				}
				// NÃO redimensiona para o `aspect`: numa edição com máscara a
				// geometria da origem é o contrato — recortar moveria a máscara em
				// relação à arte e o retoque sairia do lugar.
				const png = await toPng(imageBase64);
				out = {
					png,
					pngBase64: `data:image/png;base64,${png.toString('base64')}`,
				};
				break;
			}

			case 'ampliar': {
				// Delega ao bloco Lanczos que já existe (sem IA, com clamp de
				// megapixels). Import direto em vez de lookup no registry: se o id
				// mudar, o build quebra agora em vez de o aluno tomar "bloco
				// indisponível" no meio de um run pago.
				const origem = await sharp(p.image as Buffer).metadata();
				/**
				 * NO PREVIEW A AMPLIAÇÃO É MAIS CURTA, E ISSO É DE PROPÓSITO.
				 *
				 * `ampliar` é o único ajuste que não chama fornecedor nenhum, então
				 * é o único que roda na rota NÃO COBRADA. Mas ali a imagem volta
				 * inteira em base64 dentro do JSON, e a rota não tem cobrança nem
				 * teto de uso: 40 MP × repetir à vontade é egress nosso de graça.
				 * O teto menor mantém o ajuste grátis de verdade sem transformar o
				 * preview num gerador de arquivos de 60 MB.
				 *
				 * 24 MP ainda cobre o caso real com folga: 4× sobre a arte quadrada
				 * de 1024 (16,7 MP) passa inteiro.
				 */
				const tetoMp = ctx.preview ? MAX_MP_AMPLIAR_PREVIEW : undefined;
				escalaPedida = Number(p.factor);
				escalaReal = escalaEfetiva(
					origem.width ?? 0,
					origem.height ?? 0,
					escalaPedida,
					{ maxMp: tetoMp },
				);
				out = (await upscaleBlock.run(
					ctx,
					upscaleBlock.paramsSchema.parse({
						image: p.image,
						factor: p.factor,
						...(tetoMp ? { max_mp: tetoMp } : {}),
					}),
				)) as typeof out;
				break;
			}

			case 'remover_fundo': {
				out = (await removeBgBlock.run(
					ctx,
					removeBgBlock.paramsSchema.parse({ image: p.image }),
				)) as typeof out;
				break;
			}
		}

		// Dimensão REAL da saída (o upscale multiplica, a edição preserva a
		// origem, a geração respeita o pedido) — a galeria guarda o que existe,
		// não o que foi pedido.
		const meta = await sharp(out.png).metadata();
		return {
			...out,
			mode: p.mode,
			aspect: p.aspect,
			width: meta.width ?? width,
			height: meta.height ?? height,
			model: usedModel,
			prompt: prompt || null,
			cost_multiplier: STUDIO_MODE_COST[p.mode],
			vectorReady: out.vectorReady === true,
			tileable: out.tileable === true,
			/**
			 * A VERDADE SOBRE A AMPLIAÇÃO. `escala_real` pode ser menor que
			 * `escala_pedida` quando o teto de megapixels entra — o caso concreto é
			 * o aluno ampliar uma arte que já foi ampliada duas vezes: aos 4096 px
			 * um "4×" vira 1,55×. Sem estas chaves ele receberia uma imagem menor do
			 * que pediu e nenhuma explicação.
			 */
			escala_pedida: escalaPedida,
			escala_real:
				escalaReal !== null ? Math.round(escalaReal * 100) / 100 : null,
			limite_ampliacao:
				escalaReal !== null &&
				escalaPedida !== null &&
				escalaReal < escalaPedida - 1e-6,
		};
	},
};

export const imageStudioBlocks: ToolBlock[] = [imageStudioBlock];
