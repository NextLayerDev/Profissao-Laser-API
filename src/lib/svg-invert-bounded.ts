import {
	type InvertReason,
	injectSoleCompoundPath,
	readSvgGeometry,
	type SvgGeometry,
} from './svg-invert.js';
import {
	absorbEnclosedPockets,
	computeSilhouetteMask,
	smoothMask,
} from './svg-negative.js';
import {
	dropTinySubpaths,
	outlineMarginPx,
	removeSmallInkComponents,
	scaleAbsolutePathD,
	speckMaxAreaPx,
	traceMaskToPathD,
} from './svg-outline-trace.js';
import { rasterizeSvgToInkMask } from './svg-raster.js';

// ─────────────────────────────────────────────────────────────────────
// INVERSÃO DELIMITADA PELA SILHUETA — o complemento geométrico sem o
// quadrado preto. A peça é para GRAVAÇÃO: uma moldura do viewBox inteiro
// (o que `invertSvgPolarity` produz) seria gravada por completo. Aqui a
// moldura é a SILHUETA da própria arte, dilatada por uma margem fina — o
// "contorno fino" que delimita o invertido, como um Offset Shapes do
// LightBurn usado como limite externo do Fill (even-odd faz o resto).
//
// A 1ª encarnação dessa ideia (ver histórico em vector-invert.ts) foi
// abandonada porque o contorno re-traçado vazava em formas finas/diagonais
// — a arte ficava parcialmente FORA da região invertida. As duas defesas
// que tornam esta versão confiável:
//
//   1. VERIFICAÇÃO DE COBERTURA: o path traçado da moldura é rasterizado
//      de volta e comparado pixel a pixel com a tinta original. Vazou além
//      de um orçamento ínfimo → retenta com fechamento/margem maiores →
//      cai no retraçado. Nunca aprova geometria errada em silêncio.
//   2. FALLBACK RETRAÇADO (receita do photo-negative do comunidade_laser):
//      compõe a máscara `grava = silhueta ∧ ¬tinta` em raster e traça UMA
//      única vez — moldura e furos nascem do mesmo trace, então não existe
//      desalinhamento por construção. Perde o lossless da arte (re-traça),
//      por isso é fallback e não o caminho principal.
//
// Em nenhuma hipótese o retângulo do viewBox é emitido. Falha total = o
// chamador devolve 422, não o quadrado.
// ─────────────────────────────────────────────────────────────────────

export type BoundedInvertResult =
	| { ok: true; svg: string; strategy: 'vector' | 'retraced' }
	| { ok: false; reason: InvertReason };

/** Lado maior do raster de trabalho (teto do próprio svg-raster). */
const WORK_DIM = 2000;

/**
 * Faixa das bordas do raster excluída da verificação de cobertura: arte
 * cortada pelo enquadramento é selada por `sealAgainstEdges` e o jitter de
 * rasterização na linha do corte é inevitável — contá-lo geraria falso
 * negativo em TODO logo que encosta na borda.
 */
const EDGE_EXCLUDE_PX = 2;

interface BoundedAttempt {
	/** Multiplica o raio de fechamento default (~1% de minDim). */
	closeRMult: number;
	alphaMax: number;
	optTolerance: number;
	/** Margem extra além do contorno fino, pra 2ª tentativa folgar. */
	extraMarginPx: number;
}

/**
 * 1ª tentativa: contorno liso (tolerância folgada). Se a verificação acusar
 * vazamento, a 2ª fecha vãos diagonais com raio 2× maior e traça mais colado
 * na máscara (tolerâncias apertadas) com margem extra.
 *
 * `closeRMult` 2,5 (≈2,5% de minDim) medido no logo Total Calhas: o contorno
 * externo da placa é um traço fino separado da massa principal por vãos de
 * ~40-100px (a 2000px) — com 1,5 a silhueta parava na barra de texto e a
 * borda da placa sobrava solta fora do campo ("pequeninas falhas" na região
 * inferior direita). 2,5 funde a periferia e o fillHoles preenche a placa
 * inteira.
 */
const BOUNDED_ATTEMPTS: BoundedAttempt[] = [
	{ closeRMult: 2.5, alphaMax: 1, optTolerance: 0.4, extraMarginPx: 0 },
	{ closeRMult: 5, alphaMax: 0.8, optTolerance: 0.2, extraMarginPx: 2 },
];

/**
 * O path traçado da moldura cobre TODA a tinta original? Rasteriza o path
 * escalado no mesmo grid e conta tinta fora dele (fora da faixa de borda).
 * Orçamento pequeno absorve só anti-alias — vazamento de forma reprova.
 */
async function frameCoversInk(
	dVb: string,
	geo: SvgGeometry,
	ink: Uint8Array,
	W: number,
	H: number,
	inkCount: number,
): Promise<boolean> {
	const frameSvg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${geo.w}" height="${geo.h}" viewBox="${geo.x} ${geo.y} ${geo.w} ${geo.h}">` +
		`<path fill="#000000" d="${dVb}"/></svg>`;
	const {
		ink: frame,
		width: fw,
		height: fh,
	} = await rasterizeSvgToInkMask(frameSvg, Math.max(W, H));
	// Mesmo viewBox + mesmo maxDim ⇒ mesmas dimensões por construção; se
	// divergirem, algo mudou no raster e comparar seria mentira — reprova.
	if (fw !== W || fh !== H) return false;

	const budget = Math.max(8, Math.round(inkCount * 5e-4));
	let leaked = 0;
	for (let y = EDGE_EXCLUDE_PX; y < H - EDGE_EXCLUDE_PX; y++) {
		const row = y * W;
		for (let x = EDGE_EXCLUDE_PX; x < W - EDGE_EXCLUDE_PX; x++) {
			const i = row + x;
			if (ink[i] === 1 && frame[i] !== 1 && ++leaked > budget) return false;
		}
	}
	return true;
}

/**
 * Fallback retraçado: `grava = silhueta ∧ ¬tinta` composta em raster e
 * traçada uma única vez. Sem sanidade de cobertura mínima/máxima de
 * propósito: logo pequeno num canvas grande (silhueta ~2%) e logo que ocupa
 * o quadro inteiro (~100%) são ambos silhuetas REAIS e legítimas aqui — a
 * silhueta deriva deterministicamente da tinta, não de segmentação que
 * possa "falhar plausivelmente" como numa foto.
 */
async function retracedInvert(
	svgRaw: string,
	geo: SvgGeometry,
	ink: Uint8Array,
	W: number,
	H: number,
): Promise<BoundedInvertResult> {
	const minDim = Math.min(W, H);
	const closeR = Math.max(1, Math.round(minDim * 0.01 * 2.5));
	const marginPx = outlineMarginPx(minDim);
	// Suaviza SÓ a silhueta (borda externa do campo) — a arte entra como
	// furos via ¬tinta e não pode ser suavizada (perderia detalhe fino).
	const sil = smoothMask(
		absorbEnclosedPockets(
			computeSilhouetteMask(ink, W, H, { closeR, border: marginPx }),
			W,
			H,
			{ closeR: closeR * 2 },
		),
		W,
		H,
		Math.max(2, Math.round(marginPx / 2)),
	);

	const engrave = new Uint8Array(W * H);
	for (let i = 0; i < engrave.length; i++) {
		engrave[i] = sil[i] === 1 && ink[i] !== 1 ? 1 : 0;
	}

	// turdSize BAIXO: aqui os furos são a arte — detalhe importa.
	const dPx = await traceMaskToPathD(engrave, W, H, { turdSize: 2 });
	if (!dPx) return { ok: false, reason: 'no_geometry' };
	const dVb = scaleAbsolutePathD(dPx, geo.w / W, geo.h / H, geo.x, geo.y);
	const path = `<path fill="${geo.ink}" fill-rule="evenodd" d="${dVb}"/>`;
	return {
		ok: true,
		svg: injectSoleCompoundPath(svgRaw, path),
		strategy: 'retraced',
	};
}

/**
 * Inverte a polaridade do SVG delimitando o resultado pela silhueta da arte
 * (+ contorno fino), nunca pelo retângulo do viewBox.
 *
 * Caminho principal (`strategy: 'vector'`): compound path even-odd =
 * moldura da silhueta traçada + os `d` ORIGINAIS da arte como furos —
 * lossless pra arte, e só aceito depois da verificação de cobertura.
 */
export async function invertSvgBoundedBySilhouette(
	svgRaw: string,
): Promise<BoundedInvertResult> {
	// Um SVG com <image> é um invertido de foto persistido (ou raster puro):
	// re-inverter sobre ele geraria lixo — recusa em vez de errar.
	if (/<image\b/i.test(svgRaw)) return { ok: false, reason: 'no_geometry' };

	const geo = readSvgGeometry(svgRaw);
	if (!geo) return { ok: false, reason: 'no_geometry' };
	if (geo.fills.length > 1) return { ok: false, reason: 'multicolor' };

	const {
		ink: inkRaw,
		width: W,
		height: H,
	} = await rasterizeSvgToInkMask(svgRaw, WORK_DIM);
	const minDim = Math.min(W, H);

	// Despeckle: poeira do trace (ruído de JPEG) vira fleck branco no campo
	// invertido e serrilha a borda da silhueta. Descarta da máscara — e, no
	// caminho vetorial, também dos subpaths correspondentes da arte.
	const speckArea = speckMaxAreaPx(minDim);
	const ink = removeSmallInkComponents(inkRaw, W, H, speckArea);
	let inkCount = 0;
	for (let i = 0; i < ink.length; i++) inkCount += ink[i];
	if (inkCount === 0) return { ok: false, reason: 'no_geometry' };

	// Com transform, os `d` originais estão em coordenadas pré-transform —
	// fundi-los com a moldura sairia deslocado. O retraçado rasteriza (o sharp
	// aplica o transform certo), então vai direto pra ele.
	if (!geo.hasTransform) {
		const marginPx = outlineMarginPx(minDim);
		const sx = geo.w / W;
		const sy = geo.h / H;
		// 1,5× de folga: garante que todo subpath MANTIDO tenha footprint raster
		// acima do limiar do despeckle — mantido ⇒ presente na máscara ⇒ coberto
		// pela moldura (senão um speck limítrofe sobraria pintado fora dela).
		const dsKept = dropTinySubpaths(geo.ds, speckArea * 1.5 * sx * sy);
		if (dsKept.length === 0) return { ok: false, reason: 'no_geometry' };

		for (const attempt of BOUNDED_ATTEMPTS) {
			const closeR = Math.max(
				1,
				Math.round(minDim * 0.01 * attempt.closeRMult),
			);
			// Suavização de maioria: tira os degraus do kernel quadrado antes do
			// trace — o Potrace segue uma borda mais limpa e desvia menos.
			const frameMask = smoothMask(
				absorbEnclosedPockets(
					computeSilhouetteMask(ink, W, H, {
						closeR,
						border: marginPx + attempt.extraMarginPx,
					}),
					W,
					H,
					{ closeR: closeR * 2 },
				),
				W,
				H,
				Math.max(2, Math.round(marginPx / 2)),
			);

			let dVb: string;
			try {
				const dPx = await traceMaskToPathD(frameMask, W, H, {
					alphaMax: attempt.alphaMax,
					optTolerance: attempt.optTolerance,
				});
				if (!dPx) continue;
				dVb = scaleAbsolutePathD(dPx, sx, sy, geo.x, geo.y);
			} catch {
				continue; // comando inesperado/trace falhou → próxima tentativa
			}

			if (await frameCoversInk(dVb, geo, ink, W, H, inkCount)) {
				const path = `<path fill="${geo.ink}" fill-rule="evenodd" d="${dVb} ${dsKept.join(' ')}"/>`;
				return {
					ok: true,
					svg: injectSoleCompoundPath(svgRaw, path),
					strategy: 'vector',
				};
			}
		}
	}

	return retracedInvert(svgRaw, geo, ink, W, H);
}
