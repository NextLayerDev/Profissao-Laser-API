/**
 * Detector de "logo pronto para vetorizar" — decide se um upload do LaserPro
 * pode pular o redesenho por IA e ir direto para o trace clássico local.
 *
 * A semântica é diferente do image-classify (foto vs logo): aqui a pergunta é
 * "esta arte JÁ é binarizável sem perda?" — flat, alto contraste, sem
 * gradiente/sombra/fundo sujo. Um logo com gradiente é LOGO no classify, mas
 * NÃO está pronto: a IA ainda agrega achatando o degradê.
 *
 * Gates em AND, calibrados para PRECISÃO alta no "pronto": um falso negativo
 * só custa o que já se paga hoje (a chamada de IA); um falso positivo entrega
 * resultado pior. Na dúvida, IA.
 */
import sharp from 'sharp';

export interface ReadinessMetrics {
	width: number;
	height: number;
	/** Cores distintas quantizadas a 4 bits/canal (mesma técnica do classify). */
	uniqueColors: number;
	/** Diffs suaves / (suaves + duros) na luminância — gradiente vs borda dura. */
	softRatio: number;
	/** Fração de pixels na banda ambígua |lum − otsu| ≤ MID_BAND. */
	midRatio: number;
	/** σ² entre classes do Otsu / σ² total (0..1). Bimodal puro → ~1. */
	bimodality: number;
	/** Fração de pixels abaixo do Otsu (tinta, na polaridade padrão). */
	inkCoverage: number;
	/** Threshold de Otsu calculado no histograma de luminância. */
	otsu: number;
}

export interface ReadinessResult {
	ready: boolean;
	/** Menor margem normalizada entre os gates — diagnóstico/tuning, não decisão. */
	score: number;
	/** Gates reprovados, ex.: ['midRatio 0.09 > 0.04']. Vazio quando ready. */
	reasons: string[];
	metrics: ReadinessMetrics;
}

// ── Limiares dos gates (tunáveis por env) ──
// Calibrados em corpus sintético passado pelo MESMO fluxo do front (JPEG
// q0.85): logo P&B limpo mid≈0.001, flat colorido mid≈0.001, gradiente
// mid≈0.040, foto mid≈0.21 — midRatio é o discriminador principal (mede os
// pixels que a binarização decide arbitrariamente).
const MID_MAX = envNum('LOGO_READY_MID_MAX', 0.02);
// bimodality: logo limpo ≈0.99, gradiente ≈0.91, foto ≈0.84 — segundo
// discriminador; também manda para a IA logos com cinzas intencionais.
const BIMODAL_MIN = envNum('LOGO_READY_BIMODAL_MIN', 0.92);
// softRatio: só backstop. O chroma-subsampling do JPEG alarga bordas COLORIDAS
// em luminância (flat colorido mede ≈0.41, quase igual a gradiente ≈0.46),
// então abaixo de 0.5 ele não discrimina — quem separa é o midRatio.
const SOFT_MAX = envNum('LOGO_READY_SOFT_MAX', 0.5);
// uniqueColors: foto/render muito colorido; flat colorido JPEG mede ≈80-90
// (chroma noise sobrevive à quantização 4-bit), daí a folga.
const COLORS_MAX = envNum('LOGO_READY_COLORS_MAX', 120);
// inkCoverage: quase-vazio não tem o que traçar; tinta > máx sugere logo claro
// sobre fundo escuro (polaridade invertida — a IA normaliza melhor; fica p/ IA).
const INK_MIN = envNum('LOGO_READY_INK_MIN', 0.005);
const INK_MAX = envNum('LOGO_READY_INK_MAX', 0.6);
/** Lado mínimo do original: thumbnail não tem resolução para trace direto. */
const MIN_SIDE = 96;
/** Banda ambígua em torno do Otsu para o midRatio. */
const MID_BAND = 24;
/** Grade de análise: 512 (e não os 96 do classify) — precisa de resolução para
 *  distinguir artefato JPEG localizado de gradiente real. */
const ANALYZE_SIDE = 512;
// Mesmas bandas do image-classify: <FLAT ignora (área plana/ruído), até SOFT
// conta como gradiente suave, acima é borda dura.
const DIFF_FLAT = 4;
const DIFF_SOFT = 28;

function envNum(name: string, fallback: number): number {
	const v = Number(process.env[name]);
	return Number.isFinite(v) ? v : fallback;
}

/**
 * Threshold de Otsu: corte que maximiza a variância entre as duas classes do
 * histograma. `hist` são 256 bins de luminância; `total` a soma dos bins.
 *
 * Num histograma de dois picos puros (logo P&B) a variância entre classes é um
 * PLATÔ constante entre os picos — pegar o primeiro máximo encostaria o corte
 * no pico preto e a banda ambígua do midRatio engoliria a tinta inteira. O
 * canônico é devolver o PONTO MÉDIO do platô do argmax.
 */
export function otsuThreshold(hist: Uint32Array, total: number): number {
	let sumAll = 0;
	for (let i = 0; i < 256; i++) sumAll += i * hist[i];

	const between = new Float64Array(256);
	let bestBetween = -1;
	let wB = 0;
	let sumB = 0;
	for (let t = 0; t < 256; t++) {
		wB += hist[t];
		if (wB === 0) continue;
		const wF = total - wB;
		if (wF === 0) break;
		sumB += t * hist[t];
		const mB = sumB / wB;
		const mF = (sumAll - sumB) / wF;
		between[t] = wB * wF * (mB - mF) * (mB - mF);
		if (between[t] > bestBetween) bestBetween = between[t];
	}
	if (bestBetween <= 0) return 128;

	// Platô: primeiro e último t dentro de uma tolerância relativa do máximo.
	const floor = bestBetween * (1 - 1e-6);
	let first = -1;
	let last = -1;
	for (let t = 0; t < 256; t++) {
		if (between[t] >= floor) {
			if (first < 0) first = t;
			last = t;
		}
	}
	return Math.round((first + last) / 2);
}

/** Variância entre classes no corte `t`, normalizada pela variância total. */
function bimodalityAt(hist: Uint32Array, total: number, t: number): number {
	let sumAll = 0;
	for (let i = 0; i < 256; i++) sumAll += i * hist[i];
	const mean = sumAll / total;

	let varTotal = 0;
	for (let i = 0; i < 256; i++) varTotal += hist[i] * (i - mean) * (i - mean);
	if (varTotal <= 0) return 0; // imagem chapada uniforme: nada bimodal aqui

	let wB = 0;
	let sumB = 0;
	for (let i = 0; i <= t; i++) {
		wB += hist[i];
		sumB += i * hist[i];
	}
	const wF = total - wB;
	if (wB === 0 || wF === 0) return 0;
	const mB = sumB / wB;
	const mF = (sumAll - sumB) / wF;
	// σ²between = pB·pF·(μB−μF)² com pesos como FRAÇÕES; normaliza pela variância
	// por pixel (varTotal/total) para cair em 0..1.
	const varBetween = (wB / total) * (wF / total) * (mB - mF) * (mB - mF);
	return varBetween / (varTotal / total);
}

/**
 * Mede a imagem e aplica os gates. Nunca chama rede; ~dezenas de ms.
 * `ready=false` sempre vem com `reasons` explicando cada gate reprovado.
 */
export async function assessLogoReadiness(
	buffer: Buffer,
): Promise<ReadinessResult> {
	const meta = await sharp(buffer, { failOn: 'none' }).metadata();
	const origW = meta.width ?? 0;
	const origH = meta.height ?? 0;

	const { data, info } = await sharp(buffer, { failOn: 'none' })
		.flatten({ background: '#ffffff' })
		// NEAREST pelo mesmo motivo do image-classify: lanczos criaria banda de
		// suavização nas bordas do logo e inflaria softRatio/midRatio.
		.resize(ANALYZE_SIDE, ANALYZE_SIDE, {
			fit: 'inside',
			withoutEnlargement: true,
			kernel: 'nearest',
		})
		.removeAlpha()
		// Mesmo denoise do tracer (logo-local-trace): mata o ringing/chroma-noise
		// do JPEG q0.85 do front (oscilação de 1-2px) preservando gradientes reais,
		// que são de larga escala. Medido: sem isso, TODO JPEG limpo reprova em
		// softRatio/uniqueColors — e JPEG é o formato padrão do upload do app.
		.median(3)
		.raw()
		.toBuffer({ resolveWithObject: true });

	const W = info.width;
	const H = info.height;
	const ch = info.channels;
	const N = W * H;

	const colorKeys = new Set<number>();
	const lum = new Float32Array(N);
	const hist = new Uint32Array(256);
	for (let i = 0; i < N; i++) {
		const r = data[i * ch];
		const g = data[i * ch + 1];
		const b = data[i * ch + 2];
		colorKeys.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
		const l = 0.299 * r + 0.587 * g + 0.114 * b;
		lum[i] = l;
		hist[Math.min(255, Math.round(l))]++;
	}

	let soft = 0;
	let hard = 0;
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const i = y * W + x;
			if (x < W - 1) {
				const d = Math.abs(lum[i] - lum[i + 1]);
				if (d >= DIFF_FLAT) {
					if (d <= DIFF_SOFT) soft++;
					else hard++;
				}
			}
			if (y < H - 1) {
				const d = Math.abs(lum[i] - lum[i + W]);
				if (d >= DIFF_FLAT) {
					if (d <= DIFF_SOFT) soft++;
					else hard++;
				}
			}
		}
	}
	const softRatio = soft + hard > 0 ? soft / (soft + hard) : 0;

	const otsu = otsuThreshold(hist, N);
	const bimodality = bimodalityAt(hist, N, otsu);

	let mid = 0;
	let ink = 0;
	const lo = otsu - MID_BAND;
	const hi = otsu + MID_BAND;
	for (let i = 0; i < N; i++) {
		if (lum[i] >= lo && lum[i] <= hi) mid++;
		if (lum[i] < otsu) ink++;
	}
	const midRatio = mid / N;
	const inkCoverage = ink / N;

	const metrics: ReadinessMetrics = {
		width: origW,
		height: origH,
		uniqueColors: colorKeys.size,
		softRatio,
		midRatio,
		bimodality,
		inkCoverage,
		otsu,
	};

	// Gates em AND. `margin` normalizada (1 = folga total, 0 = no limite,
	// negativa = reprovado) — o score final é a menor margem, só para logs.
	const gates: Array<{ margin: number; reason: string }> = [
		{
			margin: (MID_MAX - midRatio) / MID_MAX,
			reason: `midRatio ${midRatio.toFixed(3)} > ${MID_MAX}`,
		},
		{
			margin: (bimodality - BIMODAL_MIN) / (1 - BIMODAL_MIN),
			reason: `bimodality ${bimodality.toFixed(3)} < ${BIMODAL_MIN}`,
		},
		{
			margin: (SOFT_MAX - softRatio) / SOFT_MAX,
			reason: `softRatio ${softRatio.toFixed(3)} > ${SOFT_MAX}`,
		},
		{
			margin: (COLORS_MAX - colorKeys.size) / COLORS_MAX,
			reason: `uniqueColors ${colorKeys.size} > ${COLORS_MAX}`,
		},
		{
			margin: Math.min(
				(inkCoverage - INK_MIN) / INK_MIN,
				(INK_MAX - inkCoverage) / INK_MAX,
			),
			reason: `inkCoverage ${inkCoverage.toFixed(4)} fora de [${INK_MIN}, ${INK_MAX}]`,
		},
		{
			margin: (Math.min(origW, origH) - MIN_SIDE) / MIN_SIDE,
			reason: `lado mínimo ${Math.min(origW, origH)}px < ${MIN_SIDE}px`,
		},
	];

	const reasons = gates.filter((g) => g.margin < 0).map((g) => g.reason);
	const score = Math.min(...gates.map((g) => g.margin));

	return { ready: reasons.length === 0, score, reasons, metrics };
}
