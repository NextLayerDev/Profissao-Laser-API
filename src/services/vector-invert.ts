import { withCapture } from '@/lib/sentry.js';
import { uploadVectorPng } from '../lib/storage.js';
import { invertSvgBoundedBySilhouette } from '../lib/svg-invert-bounded.js';
import { chooseInvertMode, invertModeForSubject } from '../lib/svg-negative.js';
import { rasterizeSvgToPng, readViewBox } from '../lib/svg-raster.js';
import { buildSilhouetteContourSvg } from '../lib/svg-silhouette-contour.js';
import { parseVectorizeParams, svgToDxf } from '../lib/vectorize.js';
import { vectorRepository } from '../repositories/vector.js';
import type { VectorizeParams } from '../types/vector.js';

// ─────────────────────────────────────────────────────────────────────
// VETOR INVERTIDO. Transformação PURA de um vetor já gerado — NÃO cobra,
// não cria linha nova e não mexe em `paid_formats`: o crédito de formato já
// pago cobre o arquivo invertido automaticamente.
//
// Dois caminhos, ambos DELIMITADOS PELA SILHUETA da arte (+ contorno fino):
//   geométrico  — compound path even-odd = silhueta traçada + arte como
//                 furos (lossless), verificado por cobertura pixel a pixel;
//                 fallback interno re-traça `silhueta ∧ ¬tinta` de uma vez.
//                 Default: logo, texto, traço.
//   silhueta    — NEGATIVO LOCAL: inverte os tons só DENTRO da silhueta do
//                 assunto (raster, preserva todo o detalhe) + contorno fino
//                 vetorial sobreposto. Pra gravura hachurada/foto.
//
// REGRA DA 5ª ENCARNAÇÃO: NUNCA emitir o retângulo do viewBox. A peça é
// para gravação — uma moldura retangular seria gravada inteira. Falhou
// tudo → 422, não o quadrado.
//
// Histórico (por que o código é assim):
//   1. negativo morfológico COM FUROS — contorno re-traçado + arte em vetor
//      como furos. O contorno não fechava direito formas finas/diagonais
//      (a pá de um remo ficava parcialmente fora — visível com zoom).
//   2. negativo RASTER puro — negate da imagem INTEIRA (como o "Negative
//      Image" do LightBurn). Perfeito por construção, mas o fundo todo
//      virava uma chapa preta pesada e "suja".
//   3. SILHUETA SÓLIDA CHAPADA — preenchia a forma inteira sem detalhe.
//      Rejeitada: "perdeu todo conteúdo da foto".
//   4. negativo local dentro da silhueta, com fallback pro raster puro
//      quando a silhueta fragmentava — o fallback devolvia o retângulo
//      preto de novo (reprovado pelo usuário, com print).
//   5. ATUAL — a nº1 ressuscitada com as defesas que faltavam (verificação
//      de cobertura + retry + fallback re-traçado de UM trace só, imune a
//      desalinhamento) no geométrico; a nº4 sem o fallback retangular e com
//      contorno fino traçado na silhueta (que também alimenta o DXF).
// ─────────────────────────────────────────────────────────────────────

export type InvertMode = 'auto' | 'geometric' | 'silhouette';

/** Mensagens de recusa que viram 422 no controller. */
export const INVERT_UNSUPPORTED = {
	multicolor: 'invert_unsupported_multicolor',
	transform: 'invert_unsupported_transform',
	no_geometry: 'invert_unsupported_no_geometry',
	no_viewbox: 'invert_unsupported_no_viewbox',
	empty: 'invert_unsupported_empty',
} as const;

export const vectorInvertService = {
	/**
	 * `persist` guarda o invertido como um vetor próprio em "Meus vetores".
	 *
	 * Regra inegociável: o registro novo HERDA `paid_formats` do pai. É o mesmo
	 * vetor com a polaridade trocada — cobrar de novo por ele seria cobrar duas
	 * vezes pelo mesmo trabalho. É a mesma razão de `handleSave` no front ser um
	 * no-op: uma cópia com `paid_formats` vazio recobraria o cliente.
	 *
	 * Idempotente por (pai, modo): alternar a polaridade várias vezes não enche a
	 * biblioteca de duplicatas — e re-inverter um vetor antigo sobrescreve o
	 * resultado persistido com o formato novo (sem retângulo).
	 */
	async invert(
		customerId: string,
		vectorId: string,
		requested: InvertMode,
		persist = false,
	) {
		return withCapture(async () => {
			const vector = await vectorRepository.findByIdForExport(
				vectorId,
				customerId,
			);

			const svgRes = await fetch(vector.svg_url);
			if (!svgRes.ok) throw new Error('Failed to fetch SVG');
			const original = await svgRes.text();

			// `auto` usa primeiro o tipo GRAVADO na geração (foto → silhueta, logo →
			// geométrico), como na referência, onde é o modo escolhido que decide.
			// Só cai na heurística de pixels em vetores antigos, sem o campo.
			const storedSubject = (vector.params as Record<string, unknown> | null)
				?.subject;
			const mode =
				requested === 'auto'
					? (invertModeForSubject(storedSubject) ??
						(await chooseInvertMode(original)))
					: requested;

			let svgContent: string;
			if (mode === 'silhouette') {
				// Foto original + params da geração → negativo RE-DITHERIZADO
				// (tons invertidos ANTES do dither, como no fluxo manual). Sem o
				// original (vetor antigo, fetch falhou), o builder cai no
				// pixel-flip de sempre.
				let originalImage: Buffer | undefined;
				const originalUrl = (vector as { original_url?: string }).original_url;
				if (originalUrl) {
					try {
						const imgRes = await fetch(originalUrl);
						if (imgRes.ok) {
							originalImage = Buffer.from(await imgRes.arrayBuffer());
						}
					} catch {
						// segue sem original
					}
				}
				// Params gravados são um VectorizeParams serializado; o merge com
				// os defaults protege contra registros antigos/parciais.
				const storedParams = {
					...parseVectorizeParams({}),
					...((vector.params as Partial<VectorizeParams> | null) ?? {}),
				} as VectorizeParams;

				const contour = await buildSilhouetteContourSvg(original, {
					originalImage,
					params: storedParams,
				});
				if (contour.ok === false) {
					throw new Error(INVERT_UNSUPPORTED[contour.reason]);
				}
				svgContent = contour.svg;
			} else {
				const result = await invertSvgBoundedBySilhouette(original);
				if (result.ok === false) {
					throw new Error(INVERT_UNSUPPORTED[result.reason]);
				}
				svgContent = result.svg;
			}

			// PNG achatado em branco: o SVG invertido pode ser um campo preto com
			// furos TRANSPARENTES — sem achatar, os furos não leem como brancos.
			// Resolução NATIVA do viewBox (não o default de 1200): reamostrar uma
			// trama de dithering cria moiré/listras no preview — os pontos têm
			// que sair 1:1.
			const vb = readViewBox(svgContent);
			const pngBuffer = await rasterizeSvgToPng(svgContent, {
				flattenWhite: true,
				maxDim: vb ? Math.max(vb.w, vb.h) : 1200,
			});
			// Caminho determinístico: re-inverter sobrescreve com o mesmo conteúdo.
			const pngUrl = await uploadVectorPng(
				pngBuffer,
				`${customerId}/${vectorId}_inverted_${mode}.png`,
			);

			const paidFormats =
				(vector as { paid_formats?: string[] }).paid_formats ?? [];

			let savedId: string | undefined;
			if (persist) {
				savedId = await vectorRepository.upsertInverted(customerId, {
					parentId: vectorId,
					mode,
					originalName: `${vector.original_name} (invertido)`,
					svgContent,
					pngUrl,
					// HERDA do pai: mesmo vetor, polaridade trocada — não recobra.
					paidFormats,
					params: (vector.params as Record<string, unknown>) ?? {},
				});
			}

			return {
				mode,
				svgContent,
				pngUrl,
				dxfContent: svgToDxf(svgContent),
				// Ecoado SEM alteração — inverter não cobra nem libera formato.
				paidFormats,
				savedId,
			};
		});
	},
};
