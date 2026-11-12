// ─────────────────────────────────────────────────────────────────────
// Vetorização AUTOMÁTICA — mesma estrutura da Comunidade Laser
// (`vectorizeImage`), com uma diferença: sem níveis de modelo. O Automático
// faz o papel do LaserPro (logo) e do LaserPro Foto (foto), e a IA é sempre o
// modelo de imagem mais forte.
//
//   1. classifica foto × logo (heurística sharp; IA de visão abaixo de 0.75)
//   2. LOGO  → traço local (readiness + Otsu + Potrace + checagem de IoU);
//              reprovou → IA redesenha em P&B → motor `laser`
//   3. FOTO  → recorta o sujeito (RMBG) → IA desenha o nanquim → limpeza →
//              máscara da silhueta → motor `fotogravacao` (ou traço local
//              quando o upload já veio recortado)
//   4. COPO ESCURO → foto: negativo local (silhueta da foto + linhas vazadas);
//                    logo: motor `negative` (sem IA)
//
// O upscale de qualidade (lanczos até o equivalente a 500 DPI + sharpen) roda
// dentro do motor, como no original; o traço local de logo amplia ×2 os
// originais pequenos. Todo resultado sai por `finalizeSvg` (mm, paths
// fechados com Z para o EzCad, tinta preta).
// ─────────────────────────────────────────────────────────────────────

import sharp from 'sharp';
import { classifyImage } from '../image-classify.js';
import { generateToolImage } from '../image-gen.js';
import { runLaserEngine } from './engine/engine.js';
import { traceLogoLocally } from './logo-local-trace.js';
import {
	BORDER_DIRTY_MAX_FRACTION,
	borderDarkFractionOfPng,
	flattenOnWhite,
	isDirtyBackground,
	maskArtWithSubject,
	type SubjectMask,
	subjectFromAlpha,
	trySegmentSubject,
} from './photo-background.js';
import {
	finalizeSvg,
	mergeIntoSingleCompoundPath,
	svgStats,
} from './svg-finalize.js';

/**
 * Modelo de imagem do Automático: sempre o mais forte do catálogo. Fixo aqui
 * (e não o default do catálogo) para uma troca de default em outra
 * ferramenta não rebaixar a vetorização em silêncio.
 */
export const VECTORIZE_AI_MODEL =
	process.env.VECTORIZE_AI_MODEL?.trim() || 'google/gemini-3-pro-image-preview';

/** Abaixo disso a heurística foto × logo pede confirmação à IA de visão. */
export const CLASSIFY_AI_GATE = 0.75;

export const DEFAULT_OUTPUT_WIDTH_MM = 120;
export const DEFAULT_OUTPUT_MARGIN_MM = 2;

export const LASERPRO_PROMPT = `Redesenhe a arte da imagem fornecida como arte vetorial profissional em preto e branco, reproduzindo-a de forma IDÊNTICA.

REGRA MAIS IMPORTANTE — FIDELIDADE TOTAL À IMAGEM ORIGINAL:
- A saída deve conter EXATAMENTE a mesma arte da imagem de entrada: mesma composição, mesmos elementos, mesmas proporções e mesmo enquadramento.
- NÃO adicione NADA que não exista na imagem original: nenhum texto novo, nenhuma palavra, nenhuma letra, nenhum número, nenhum objeto, nenhum produto, nenhum copo, caneca, camiseta ou qualquer mockup, nenhuma moldura ou borda, nenhum fundo ou cenário, nenhuma marca d'água, nenhuma assinatura, nenhum ornamento decorativo.
- NÃO remova, substitua ou redesenhe elementos existentes. NÃO "melhore", NÃO reinterprete e NÃO crie uma variação da arte.
- Se a imagem contém texto, reproduza-o LETRA POR LETRA, com o mesmo desenho de fonte. NUNCA invente, corrija, traduza ou complete texto.
- NÃO aplique a arte sobre nenhum objeto ou superfície. O resultado é a arte SOZINHA, plana e frontal, sobre fundo branco puro.

CONVERSÃO DE ESTILO (a única transformação permitida):
- Remover todas as cores: apenas preto puro (#000000) nas áreas sólidas e branco puro (#FFFFFF) no fundo.
- Contornos nítidos e bem definidos; texto existente com leitura perfeita.
- Sem gradientes, sombras, tons de cinza ou efeitos rasterizados.
- Caminhos fechados, contínuos e limpos, prontos para gravação ou corte a laser.

Estilo final: a MESMA arte da entrada, em vetor P&B de alto contraste, acabamento profissional.`;

export const FOTOGRAVACAO_PROMPT = `Converta esta foto em uma gravura estilo "nanquim vetorizado": linhas limpas, alto contraste, hachuras finas e preenchimentos sólidos nas sombras profundas, em preto puro sobre fundo branco puro.

REGRA MAIS IMPORTANTE — FIDELIDADE TOTAL À FOTO ORIGINAL:
- Reproduza EXATAMENTE o conteúdo da foto: mesmas pessoas, mesmos objetos, mesma pose, mesma expressão, mesma composição e proporções. Apenas o ESTILO muda (foto → gravura); o conteúdo NÃO muda.
- NÃO adicione NADA: nenhum texto, palavra, letra, data ou assinatura; nenhum objeto, produto, copo, caneca ou mockup; nenhuma moldura, borda decorativa ou marca d'água.
- NÃO aplique a imagem sobre nenhum objeto ou superfície — o resultado é a gravura SOZINHA, plana e frontal, sobre fundo branco puro.
- NÃO recorte partes do assunto principal e NÃO invente partes que não aparecem na foto.

RECORTE E FUNDO (sem quadrado de fundo):
- O assunto deve ser entregue RECORTADO pela própria silhueta, com um contorno limpo e contínuo acompanhando toda a silhueta.
- Remova o fundo da foto por completo: fundo branco puro ABSOLUTO (#FFFFFF), 100% vazio e uniforme — sem quadrado ou painel atrás do assunto, sem moldura, sem sombra projetada, sem textura, sem ruído e sem nenhum tom de cinza no fundo.
- NUNCA desenhe um retângulo, quadrado ou cenário atrás do assunto. A gravura entregue é SÓ o assunto e seu contorno, nada ao redor.

QUALIDADE DOS DETALHES:
- Rostos, olhos, cabelos e mãos devem manter TODOS os detalhes, desenhados com hachuras finas. NUNCA transforme olhos ou partes do rosto em manchas pretas sólidas ou buracos vazios.
- Áreas escuras da foto viram hachuras densas ou preto sólido apenas nas sombras mais profundas; áreas claras viram hachuras espaçadas ou branco — preservando a sensação de volume e profundidade.

Resultado: apenas preto e branco (sem tons de cinza), contorno da silhueta bem definido, arquivo pronto para gravação a laser.`;

/** Reforço da 2ª tentativa quando a 1ª arte veio com fundo sujo nas bordas. */
const FOTOGRAVACAO_RETRY_SUFFIX = `

ATENÇÃO — A TENTATIVA ANTERIOR FOI REPROVADA: veio com fundo escuro/cenário encostando nas bordas da imagem. Desta vez as BORDAS da imagem devem ficar em branco puro (#FFFFFF): só o assunto, recortado pela silhueta, centralizado sobre branco.`;

export type ImageKind = 'photo' | 'logo';

export interface AutoVectorizeInput {
	buffer: Buffer;
	/** Força o caminho (opção avançada). Ausente = classificação automática. */
	kind?: ImageKind;
	/** Copo escuro / negativo: grava os claros, sem quadrado de fundo. */
	darkCup?: boolean;
	/** Largura útil em mm (sem a margem). */
	widthMm?: number;
	marginMm?: number;
	signal?: AbortSignal;
}

export interface AutoVectorizeResult {
	svgContent: string;
	kind: ImageKind;
	/** De onde veio a decisão foto × logo. */
	kindSource: 'forced' | 'heuristic' | 'ai' | 'heuristic-fallback';
	/** 'local' = traço sem IA; 'ai' = passou pelo modelo de imagem. */
	engine: 'local' | 'ai';
	/** Caminho efetivo, para log e para o relatório de qualidade. */
	route:
		| 'logo-local'
		| 'logo-ai-laser'
		| 'logo-negative'
		| 'photo-local-positive'
		| 'photo-local-negative'
		| 'photo-fotogravacao'
		| 'photo-negative';
	aiAttempts: number;
	backgroundRemoved: boolean | null;
	upscaled: { from: number; to: number } | null;
	stats: { paths: number; nodes: number; timeMs: number };
	timings: Record<string, number>;
	widthMm: number;
	heightMm: number;
}

/** Arte nanquim da IA: alpha → branco, cinza, quase-branco/quase-preto puros.
 *  Sem isso um fundo 240 derruba a rota binária e o dither pinta o fundo. */
export async function cleanNanquimArt(buffer: Buffer): Promise<Buffer> {
	const { data, info } = await sharp(buffer, { failOn: 'none' })
		.flatten({ background: '#ffffff' })
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	for (let i = 0; i < data.length; i++) {
		if (data[i] >= 235) data[i] = 255;
		else if (data[i] <= 20) data[i] = 0;
	}
	return sharp(data, {
		raw: {
			width: info.width,
			height: info.height,
			channels: info.channels as 1 | 2 | 3 | 4,
		},
	})
		.png()
		.toBuffer();
}

async function drawWithAi(
	prompt: string,
	image: Buffer,
	signal?: AbortSignal,
): Promise<Buffer> {
	// Só a mensagem do usuário, como na Comunidade: sem system prompt genérico
	// do Estúdio e sem resize forçado (a proporção é a da arte devolvida).
	const { png } = await generateToolImage(prompt, [image], signal, {
		model: VECTORIZE_AI_MODEL,
		rawPrompt: true,
		formatoReal: false,
	});
	return png;
}

function svgHeightMm(svg: string): number {
	const h = svg.match(/<svg[^>]*\bheight="([\d.]+)mm"/i)?.[1];
	return h ? Number(h) : 0;
}

/**
 * Vetoriza no modo Automático. Lança em falha (IA, motor) — o controller
 * estorna a cobrança.
 */
export async function vectorizeAuto(
	input: AutoVectorizeInput,
): Promise<AutoVectorizeResult> {
	const t0 = Date.now();
	const timings: Record<string, number> = {};
	const lap = (name: string, since: number) => {
		timings[name] = Date.now() - since;
	};
	const widthMm = input.widthMm ?? DEFAULT_OUTPUT_WIDTH_MM;
	const marginMm = input.marginMm ?? DEFAULT_OUTPUT_MARGIN_MM;
	const darkCup = !!input.darkCup;
	const finalize = (svg: string) => finalizeSvg(svg, widthMm, marginMm);

	// ─── 1. Foto × logo ───
	let kind: ImageKind;
	let kindSource: AutoVectorizeResult['kindSource'];
	if (input.kind) {
		kind = input.kind;
		kindSource = 'forced';
	} else {
		const tc = Date.now();
		const c = await classifyImage(input.buffer, { aiGate: CLASSIFY_AI_GATE });
		kind = c.kind;
		kindSource = c.source;
		lap('classify', tc);
	}

	let svgContent: string;
	let engine: AutoVectorizeResult['engine'] = 'ai';
	let route: AutoVectorizeResult['route'];
	let aiAttempts = 0;
	let backgroundRemoved: boolean | null = null;
	let upscaled: AutoVectorizeResult['upscaled'] = null;

	if (kind === 'logo') {
		if (darkCup) {
			// Copo escuro de logo: o negativo por silhueta do motor já resolve; a IA
			// de redesenho P&B não agrega e custaria uma chamada.
			const te = Date.now();
			const out = await runLaserEngine(input.buffer, 'negative');
			upscaled = out.upscaled;
			svgContent = mergeIntoSingleCompoundPath(finalize(out.svg));
			engine = 'local';
			route = 'logo-negative';
			lap('engine', te);
		} else {
			// ─── 2. Logo pronto: traço local; IA só se a checagem reprovar ───
			const tl = Date.now();
			let local: Awaited<ReturnType<typeof traceLogoLocally>> = null;
			try {
				local = await traceLogoLocally(input.buffer, { invert: true });
			} catch (err) {
				console.error('[vetor-auto] traço local falhou, seguindo com IA:', err);
			}
			lap('localTrace', tl);
			if (local) {
				svgContent = finalize(local.svg);
				engine = 'local';
				route = 'logo-local';
			} else {
				const ta = Date.now();
				const art = await drawWithAi(
					LASERPRO_PROMPT,
					await flattenOnWhite(input.buffer),
					input.signal,
				);
				aiAttempts = 1;
				lap('ai', ta);
				const te = Date.now();
				const out = await runLaserEngine(art, 'laser');
				upscaled = out.upscaled;
				svgContent = finalize(out.svg);
				route = 'logo-ai-laser';
				lap('engine', te);
			}
		}
	} else {
		// ─── 3. Foto: recorte → nanquim da IA → traço ───
		const ts = Date.now();
		const subject = await trySegmentSubject(input.buffer);
		const uploadCutout = await subjectFromAlpha(input.buffer);
		lap('segment', ts);
		// Copo escuro: a silhueta do negativo sai da FOTO, não da arte de linha.
		const photoSubject: SubjectMask | null = darkCup
			? (uploadCutout ?? subject)
			: null;

		const finishArt = async (raw: Buffer) => {
			let png = await cleanNanquimArt(raw);
			if (subject) {
				const masked = await maskArtWithSubject(png, subject);
				if (masked) png = masked;
			}
			return { png, borderDark: await borderDarkFractionOfPng(png) };
		};

		const aiInput =
			subject?.onWhitePng ??
			uploadCutout?.onWhitePng ??
			(await flattenOnWhite(input.buffer));
		const ta = Date.now();
		let best = await finishArt(
			await drawWithAi(FOTOGRAVACAO_PROMPT, aiInput, input.signal),
		);
		aiAttempts = 1;
		// Fundo sujo encostando nas bordas: refaz 1 vez e fica com a mais limpa.
		if (isDirtyBackground(best.borderDark)) {
			console.warn(
				`[vetor-auto] fundo sujo (borda escura ${(best.borderDark * 100).toFixed(1)}% > ${BORDER_DIRTY_MAX_FRACTION * 100}%) — refazendo a IA`,
			);
			try {
				const second = await finishArt(
					await drawWithAi(
						FOTOGRAVACAO_PROMPT + FOTOGRAVACAO_RETRY_SUFFIX,
						aiInput,
						input.signal,
					),
				);
				aiAttempts = 2;
				if (second.borderDark < best.borderDark) best = second;
			} catch (err) {
				console.error('[vetor-auto] 2ª tentativa da IA falhou:', err);
			}
		}
		lap('ai', ta);
		backgroundRemoved = subject !== null;
		const art = best.png;

		// Negativo (copo escuro) sempre local; positivo local só com upload já
		// recortado — sem ele o motor `fotogravacao` traça a arte.
		const localPolarity = darkCup
			? 'negative'
			: uploadCutout
				? 'positive'
				: null;
		let done = false;
		if (localPolarity) {
			const tn = Date.now();
			try {
				const { buildPhotoNegativeSvg } = await import('./photo-negative.js');
				const silhouette =
					localPolarity === 'negative' ? photoSubject : uploadCutout;
				const neg = await buildPhotoNegativeSvg(art, {
					polarity: localPolarity,
					...(silhouette ? { photoSubject: silhouette } : {}),
				});
				svgContent = mergeIntoSingleCompoundPath(finalize(neg.svg));
				route =
					localPolarity === 'negative'
						? 'photo-local-negative'
						: 'photo-local-positive';
				done = true;
			} catch (err) {
				console.error(
					`[vetor-auto] ${localPolarity} local falhou, seguindo com o motor:`,
					err,
				);
			}
			lap('localTrace', tn);
		}
		if (!done) {
			const te = Date.now();
			const out = await runLaserEngine(
				art,
				darkCup ? 'negative' : 'fotogravacao',
			);
			upscaled = out.upscaled;
			svgContent = finalize(out.svg);
			if (darkCup) svgContent = mergeIntoSingleCompoundPath(svgContent);
			route = darkCup ? 'photo-negative' : 'photo-fotogravacao';
			lap('engine', te);
		}
	}

	// biome-ignore lint/style/noNonNullAssertion: todos os ramos atribuem
	const svg = svgContent!;
	const timeMs = Date.now() - t0;
	console.log(
		`[vetor-auto] kind=${kind}(${kindSource}) route=${
			// biome-ignore lint/style/noNonNullAssertion: todos os ramos atribuem
			route!
		} ai=${aiAttempts} ms=${timeMs} svg=${(Buffer.byteLength(svg) / 1e6).toFixed(2)}MB`,
	);
	return {
		svgContent: svg,
		kind,
		kindSource,
		engine,
		// biome-ignore lint/style/noNonNullAssertion: todos os ramos atribuem
		route: route!,
		aiAttempts,
		backgroundRemoved,
		upscaled,
		stats: { ...svgStats(svg), timeMs },
		timings,
		widthMm,
		heightMm: Math.max(0, svgHeightMm(svg) - 2 * marginMm),
	};
}
