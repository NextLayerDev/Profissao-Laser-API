/**
 * Trace clássico LOCAL para logos já prontos (LaserPro sem IA).
 *
 * Pipeline: readiness (logo-readiness.ts) → binarização por Otsu → potrace →
 * verificação de fidelidade (IoU do raster do SVG contra a máscara traçada).
 * Qualquer reprovação devolve `null` e o chamador segue com o caminho de IA —
 * o usuário nunca recebe um resultado pior do que receberia hoje.
 *
 * Paridade com o upstream mode=laser: mapParams só manda blackOnWhite='false'
 * quando !invert, então aqui `blackOnWhite: opts.invert`; o fill final é
 * '#FFFFFF' como o `color` que mapParams força. O trace roda em preto e o fill
 * só vira branco DEPOIS da fidelidade — branco sobre fundo branco deixaria a
 * medição cega.
 */
import sharp from 'sharp';
import {
	assessLogoReadiness,
	otsuThreshold,
	type ReadinessResult,
} from './logo-readiness.js';
import {
	extractPathD,
	maskToPng,
	TRACE_OPTS,
	tracePromise,
} from './vector/potrace-utils.js';

/** Grade de trabalho: o front já limita o upload a 1500px, então na prática
 *  não há downscale — o teto só protege contra chamadas fora do fluxo do app. */
const MAX_SIDE = envNum('LOGO_TRACE_MAX_SIDE', 1600);
/** turdSize 5 (default do upstream) e não os 2 do TRACE_OPTS: logo quer menos
 *  speckle de JPEG virando path. */
const TURD_SIZE = envNum('LOGO_TRACE_TURD', 5);
/** IoU mínimo para aceitar o trace. 0.90 dá margem para o anti-alias de ~1px
 *  do librsvg em texto fino; subir se o corpus mostrar folga. */
const FIDELITY_MIN_IOU = envNum('LOGO_FIDELITY_MIN_IOU', 0.9);
/** Abaixo disso o potrace gera curvas quadradas — upscale ×2 antes do trace. */
const UPSCALE_BELOW = 500;
/** Otsu clampado: só contra os EXTREMOS onde o corte encostaria no ruído do
 *  fundo (pós-median o fundo branco fica ≥ ~245). O clamp precisa ser largo:
 *  tinta clara legítima (logo azul-claro/amarelo sobre branco) pede corte alto —
 *  medido: um logo azul-claro real precisa de Otsu ≈ 218. */
const OTSU_MIN = 40;
const OTSU_MAX = 235;
/** Cobertura plausível do conjunto traçado (fora disso a máscara é degenerada). */
const COVERAGE_MIN = 0.003;
const COVERAGE_MAX = 0.995;
/** SVG acima disso = o trace explodiu em micro-paths; a arte não era tão limpa. */
const MAX_SVG_BYTES = 2 * 1024 * 1024;

function envNum(name: string, fallback: number): number {
	const v = Number(process.env[name]);
	return Number.isFinite(v) ? v : fallback;
}

export interface LogoLocalOptions {
	/** Mesma semântica do VectorizeInput: true (default do app) traça a tinta escura. */
	invert: boolean;
	maxSide?: number;
	turdSize?: number;
	fidelityMinIoU?: number;
	/** Debug: traça mesmo com readiness reprovado (tuning dos gates). */
	forceTrace?: boolean;
	/** Debug: devolve a máscara binarizada e o raster do SVG em PNG. */
	includeDebug?: boolean;
}

export interface LogoLocalResult {
	/** SVG do potrace (viewBox="0 0 W H", 1 path evenodd) já com fill branco. */
	svg: string;
	width: number;
	height: number;
	/** Otsu clampado usado na binarização da grade de trabalho. */
	threshold: number;
	inkCoverage: number;
	fidelity: { iou: number; dice: number };
	readiness: ReadinessResult;
	timings: { readinessMs: number; traceMs: number; fidelityMs: number };
	debug?: { maskPng: Buffer; rasterPng: Buffer };
}

/**
 * Vetoriza um logo pronto localmente. `null` = não elegível (readiness ou
 * fidelidade reprovou, caso degenerado) — o chamador segue com a IA. Loga o
 * motivo em `[logo-local]` para a taxa de acerto sair dos logs de produção.
 */
export async function traceLogoLocally(
	buffer: Buffer,
	opts: LogoLocalOptions,
): Promise<LogoLocalResult | null> {
	const maxSide = opts.maxSide ?? MAX_SIDE;
	const turdSize = opts.turdSize ?? TURD_SIZE;
	const minIoU = opts.fidelityMinIoU ?? FIDELITY_MIN_IOU;

	// ─── 1. Prontidão ───
	const t0 = Date.now();
	const readiness = await assessLogoReadiness(buffer);
	const readinessMs = Date.now() - t0;
	if (!readiness.ready && !opts.forceTrace) {
		console.log(
			`[logo-local] engine=ai reason=readiness score=${readiness.score.toFixed(3)} reasons=[${readiness.reasons.join('; ')}]`,
		);
		return null;
	}

	// ─── 2. Grade de trabalho: flatten → resize → cinza → median(3) ───
	// O median mata o mosquito-noise do JPEG do front preservando cantos (blur
	// arredondaria). Originais pequenos sobem ×2 (lanczos) antes: potrace em
	// grade pequena gera curvas quadradas.
	const { width: origW, height: origH } = readiness.metrics;
	const small = Math.min(origW, origH);
	const scale = small > 0 && small < UPSCALE_BELOW ? 2 : 1;
	// Sem dimensões no metadata (formato exótico): grade padrão, sem upscale.
	const targetW =
		origW > 0 ? Math.min(Math.round(origW * scale), maxSide) : maxSide;
	const targetH =
		origH > 0 ? Math.min(Math.round(origH * scale), maxSide) : maxSide;

	const { data: gray, info } = await sharp(buffer, { failOn: 'none' })
		.flatten({ background: '#ffffff' })
		.resize(targetW, targetH, {
			fit: 'inside',
			withoutEnlargement: scale === 1,
		})
		.grayscale()
		.median(3)
		.raw()
		.toBuffer({ resolveWithObject: true });
	const W = info.width;
	const H = info.height;
	const N = W * H;

	// ─── 3. Otsu recalculado na grade de trabalho (o median muda a distribuição) ───
	const hist = new Uint32Array(256);
	for (let i = 0; i < N; i++) hist[gray[i]]++;
	const threshold = Math.min(
		OTSU_MAX,
		Math.max(OTSU_MIN, otsuThreshold(hist, N)),
	);

	// ─── 4. Binarização na convenção do repo (0 = tinta, 255 = fundo) ───
	const mask = Buffer.alloc(N);
	let ink = 0;
	for (let i = 0; i < N; i++) {
		if (gray[i] < threshold) {
			mask[i] = 0;
			ink++;
		} else {
			mask[i] = 255;
		}
	}
	const inkCoverage = ink / N;

	// Conjunto que o potrace vai traçar: com invert (default) é a tinta; sem,
	// o complemento claro (blackOnWhite=false), igual ao upstream.
	const tracedCoverage = opts.invert ? inkCoverage : 1 - inkCoverage;
	if (tracedCoverage < COVERAGE_MIN || tracedCoverage > COVERAGE_MAX) {
		console.log(
			`[logo-local] engine=ai reason=degenerate tracedCoverage=${tracedCoverage.toFixed(4)}`,
		);
		return null;
	}

	// ─── 5. Trace (em preto — a fidelidade precisa enxergar o raster) ───
	const t1 = Date.now();
	const maskPng = await maskToPng(mask, W, H);
	const svgBlack = await tracePromise(maskPng, {
		...TRACE_OPTS,
		turdSize,
		blackOnWhite: opts.invert,
		color: '#000000',
	});
	const traceMs = Date.now() - t1;

	if (!extractPathD(svgBlack)) {
		console.log('[logo-local] engine=ai reason=degenerate empty-path');
		return null;
	}
	if (Buffer.byteLength(svgBlack) > MAX_SVG_BYTES) {
		console.log(
			`[logo-local] engine=ai reason=degenerate svgBytes=${Buffer.byteLength(svgBlack)}`,
		);
		return null;
	}

	// ─── 6. Fidelidade: raster do SVG vs conjunto traçado, na mesma grade ───
	const t2 = Date.now();
	const raster = await sharp(Buffer.from(svgBlack))
		.resize(W, H, { fit: 'fill' })
		.flatten({ background: '#ffffff' })
		.grayscale()
		.raw()
		.toBuffer();
	let inter = 0;
	let sizeT = 0;
	let sizeR = 0;
	for (let i = 0; i < N; i++) {
		const t = opts.invert ? mask[i] === 0 : mask[i] === 255;
		const r = raster[i] < 128;
		if (t) sizeT++;
		if (r) sizeR++;
		if (t && r) inter++;
	}
	const union = sizeT + sizeR - inter;
	const iou = union > 0 ? inter / union : 0;
	const dice = sizeT + sizeR > 0 ? (2 * inter) / (sizeT + sizeR) : 0;
	const fidelityMs = Date.now() - t2;

	if (sizeR === 0) {
		console.log('[logo-local] engine=ai reason=degenerate empty-raster');
		return null;
	}
	if (iou < minIoU && !opts.forceTrace) {
		console.log(
			`[logo-local] engine=ai reason=fidelity iou=${iou.toFixed(3)} dice=${dice.toFixed(3)} min=${minIoU}`,
		);
		return null;
	}

	// ─── 7. Aprovado: fill branco, paridade com o color='#FFFFFF' do mapParams ───
	const svg = svgBlack.replace(
		/(<path\b[^>]*\bfill=")[^"]*(")/gi,
		'$1#FFFFFF$2',
	);

	return {
		svg,
		width: W,
		height: H,
		threshold,
		inkCoverage,
		fidelity: { iou, dice },
		readiness,
		timings: { readinessMs, traceMs, fidelityMs },
		...(opts.includeDebug
			? {
					debug: {
						maskPng,
						rasterPng: await maskToPng(rasterToMask(raster, N), W, H),
					},
				}
			: {}),
	};
}

/** Converte o raster cinza do SVG em máscara 0/255 para o PNG de debug. */
function rasterToMask(raster: Buffer, n: number): Buffer {
	const out = Buffer.alloc(n);
	for (let i = 0; i < n; i++) out[i] = raster[i] < 128 ? 0 : 255;
	return out;
}
