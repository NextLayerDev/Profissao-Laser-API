import { withCapture } from '@/lib/sentry.js';
import { uploadVectorPng } from '../lib/storage.js';
import { invertSvgPolarity, readSvgGeometry } from '../lib/svg-invert.js';
import {
	chooseInvertMode,
	invertModeForSubject,
	silhouetteMaskPng,
} from '../lib/svg-negative.js';
import { rasterizeSvgToPng } from '../lib/svg-raster.js';
import {
	parseVectorizeParams,
	svgToDxf,
	vectorizeImage,
} from '../lib/vectorize.js';
import { vectorRepository } from '../repositories/vector.js';

// ─────────────────────────────────────────────────────────────────────
// VETOR INVERTIDO (fundo preto). Transformação PURA de um vetor já gerado —
// NÃO cobra, não cria linha nova e não mexe em `paid_formats`: o crédito de
// formato já pago cobre o arquivo invertido automaticamente.
//
// Dois caminhos:
//   geométrico  — complemento exato (lossless). Default: logo, texto, traço.
//   silhueta    — negativo morfológico. Só pra gravura hachurada, onde o
//                 complemento viraria uma chapa preta.
// ─────────────────────────────────────────────────────────────────────

export type InvertMode = 'auto' | 'geometric' | 'silhouette';

/** Mensagens de recusa que viram 422 no controller. */
export const INVERT_UNSUPPORTED = {
	multicolor: 'invert_unsupported_multicolor',
	transform: 'invert_unsupported_transform',
	no_geometry: 'invert_unsupported_no_geometry',
	no_viewbox: 'invert_unsupported_no_viewbox',
} as const;

/** Escala todos os números de um `d` — o Potrace só emite M/L/C/Z absolutos. */
function scalePathNumbers(d: string, s: number): string {
	if (s === 1) return d;
	return d.replace(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g, (n) =>
		(Number.parseFloat(n) * s).toFixed(2),
	);
}

/**
 * Negativo por silhueta, SEM perder a arte.
 *
 * A versão anterior rasterizava o SVG a 1200px, fazia a morfologia e
 * RE-TRAÇAVA tudo — a hachura fina passava por um round-trip de raster e
 * chegava borrada ("perdendo muito detalhe").
 *
 * Aqui o raster é usado só para o CONTORNO da silhueta, que é uma forma lisa e
 * não precisa de resolução. A arte continua sendo os `d` originais, em vetor,
 * entrando como furos no mesmo compound path (even-odd). Resultado: campo preto
 * no formato da figura, hachura em fidelidade total.
 */
async function silhouettePath(svg: string): Promise<string> {
	const geo = readSvgGeometry(svg);
	if (!geo) throw new Error(INVERT_UNSUPPORTED.no_geometry);

	// Rasteriza na própria escala do viewBox (teto de 2000) → o contorno traçado
	// já sai no sistema de coordenadas da arte; o resto é um fator de escala.
	const target = Math.min(2000, Math.max(512, Math.round(geo.w)));
	const { png, width } = await silhouetteMaskPng(svg, target);

	const outlineSvg = await vectorizeImage(
		png,
		parseVectorizeParams({
			mode: 'trace',
			edgeDetection: 'none',
			threshold: '128',
			turdSize: '8', // contorno liso: suprime respingos da morfologia
		}),
	);
	const outlineD = outlineSvg.match(/\bd="([^"]+)"/)?.[1];
	if (!outlineD) throw new Error(INVERT_UNSUPPORTED.no_geometry);

	// O trace do contorno sai em px do raster; a arte está em unidades do
	// viewBox. Um fator só alinha os dois (o Potrace não usa comandos relativos).
	const scaled = scalePathNumbers(outlineD, geo.w / width);
	const combined = `${scaled} ${geo.ds.join(' ')}`;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${geo.w}" height="${geo.h}" viewBox="${geo.x} ${geo.y} ${geo.w} ${geo.h}"><path fill="${geo.ink}" fill-rule="evenodd" d="${combined}"/></svg>`;
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
				svgContent = await silhouettePath(original);
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
