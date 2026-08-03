import sharp from 'sharp';
import { withCapture } from '@/lib/sentry.js';
import { uploadVectorPng } from '../lib/storage.js';
import { invertSvgPolarity, readSvgGeometry } from '../lib/svg-invert.js';
import { chooseInvertMode, invertModeForSubject } from '../lib/svg-negative.js';
import { rasterizeSvgToPng } from '../lib/svg-raster.js';
import { svgToDxf } from '../lib/vectorize.js';
import { vectorRepository } from '../repositories/vector.js';

// ─────────────────────────────────────────────────────────────────────
// VETOR INVERTIDO (fundo preto). Transformação PURA de um vetor já gerado —
// NÃO cobra, não cria linha nova e não mexe em `paid_formats`: o crédito de
// formato já pago cobre o arquivo invertido automaticamente.
//
// Dois caminhos:
//   geométrico  — complemento exato (lossless). Default: logo, texto, traço.
//   silhueta    — negativo RASTER. Só pra gravura hachurada, onde o
//                 complemento viraria uma chapa preta.
//
// A silhueta já foi um negativo MORFOLÓGICO (reconstruía um contorno
// vetorial da silhueta via raster→morfologia→re-trace, mantendo a arte
// original em vetor como furos). Trocado por raster puro: a reconstrução do
// contorno não fechava direito formas finas/diagonais (ex.: a pá de um remo
// cruzado ficava parcialmente fora do contorno calculado — visível com
// zoom, reportado pelo usuário) — limitação de fundo da morfologia de
// fechamento, não um bug de escala/deslocamento (esse foi achado e
// corrigido no caminho, mas não resolveu sozinho).
//
// A referência do setor (LightBurn) confirma: pra imagem/foto eles NÃO
// tentam reconstruir contorno nenhum — só invertem os valores de pixel do
// raster ("Negative Image"). Perfeito por construção, sem etapa de
// aproximação. Custo: o resultado deixa de ser 100% vetor (paths) — vira uma
// imagem embutida no SVG. Isso já era esperado pro DXF de uma foto invertida
// (só a moldura, sem preenchimento — DXF não tem conceito de preenchimento
// mesmo com paths) e passa a valer pro SVG/PNG também.
// ─────────────────────────────────────────────────────────────────────

export type InvertMode = 'auto' | 'geometric' | 'silhouette';

/** Mensagens de recusa que viram 422 no controller. */
export const INVERT_UNSUPPORTED = {
	multicolor: 'invert_unsupported_multicolor',
	transform: 'invert_unsupported_transform',
	no_geometry: 'invert_unsupported_no_geometry',
	no_viewbox: 'invert_unsupported_no_viewbox',
} as const;

/**
 * Negativo RASTER puro — inverte os pixels do PNG rasterizado direto, sem
 * nenhuma etapa de reconstrução de contorno. Mesma prática do LightBurn (e do
 * setor em geral) pra imagem/foto: "Negative Image" só inverte os valores de
 * pixel — sem aproximação, então não tem como sair errado de forma.
 *
 * O resultado deixa de ser 100% vetor (paths) pra essa variant — vira uma
 * imagem embutida no SVG (mesmo contrato de arquivo). Isso já era esperado
 * no DXF de uma foto invertida (só a moldura, sem preenchimento) e passa a
 * valer também pro SVG/PNG — troca aceita: sem isso a silhueta reconstruída
 * deixava pedaços de formas finas/diagonais (ex.: a pá de um remo cruzado)
 * "vazando" pra fora do contorno calculado.
 */
async function rasterNegative(svg: string): Promise<string> {
	const geo = readSvgGeometry(svg);
	if (!geo) throw new Error(INVERT_UNSUPPORTED.no_geometry);

	// Rasteriza a arte ATUAL (ainda não invertida), achatada em branco — teto
	// de resolução do próprio `rasterizeSvgToPng` (2000px), suficiente pra
	// gravação a laser.
	const png = await rasterizeSvgToPng(svg, {
		maxDim: 2000,
		flattenWhite: true,
	});
	// Inversão de pixel exata. `alpha:false` porque já achatamos em branco
	// (sem transparência de verdade pra inverter).
	const negated = await sharp(png).negate({ alpha: false }).png().toBuffer();
	const b64 = negated.toString('base64');

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${geo.w}" height="${geo.h}" viewBox="${geo.x} ${geo.y} ${geo.w} ${geo.h}"><image x="${geo.x}" y="${geo.y}" width="${geo.w}" height="${geo.h}" preserveAspectRatio="none" href="data:image/png;base64,${b64}"/></svg>`;
}

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
	 * biblioteca de duplicatas.
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
				svgContent = await rasterNegative(original);
			} else {
				const result = invertSvgPolarity(original);
				if ('error' in result) {
					throw new Error(INVERT_UNSUPPORTED[result.error]);
				}
				svgContent = result.svg;
			}

			// PNG achatado em branco: o SVG invertido é um campo preto com furos
			// TRANSPARENTES — sem achatar, os furos não leem como brancos.
			const pngBuffer = await rasterizeSvgToPng(svgContent, {
				flattenWhite: true,
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
