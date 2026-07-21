import sharp from 'sharp';
import { openrouter } from './openrouter.js';

// ─────────────────────────────────────────────────────────────────────
// Classificação FOTO vs LOGO — decide qual PROMPT a vetorização com IA usa
// (foto → gravura nanquim; logo → redesenho vetorial fiel). A semântica é
// "tom contínuo vs arte chapada": um retrato a lápis realista é FOTO (rende
// melhor no pipeline de gravura); um cartoon flat de um pet é LOGO.
//
// Duas camadas: heurística com sharp (grátis, ~50ms, resolve os casos claros)
// e IA de visão barata só na zona de dúvida, com fallback pra heurística.
//
// NÃO confundir com `analyzeImage` (vectorize-analyze.ts): aquele escolhe os
// PARÂMETROS DO MOTOR pro router Automático e tem classes grosseiras demais
// pra esta pergunta (`color_flat` cobre tanto ilustração chapada quanto render
// fotográfico). Este aqui só escolhe o prompt.
// ─────────────────────────────────────────────────────────────────────

export interface ClassifyMetrics {
	/** Cores distintas quantizadas (4 bits/canal). */
	uniqueColors: number;
	/** Níveis de luminância distintos (0-255) — cobre imagens P&B. */
	lumLevels: number;
	/** Fração de pixels nos 6 bins de luminância dominantes (de 32). */
	lumCoverage: number;
	/** Diffs suaves / (suaves + duros) na luminância. */
	softRatio: number;
	/** Fração de pixels quase-preto/quase-branco. */
	bilevelRatio: number;
}

export interface ClassifyResult {
	kind: 'photo' | 'logo';
	/** 0..1 */
	confidence: number;
	source: 'heuristic' | 'ai' | 'heuristic-fallback';
	metrics?: ClassifyMetrics;
}

// ─── Limiares da heurística (tunáveis) ───────────────────────────────
const COLOR_LOW = 60; // uniqueColors: logo típico fica abaixo
const COLOR_HIGH = 250; // foto típica fica acima
const LUM_LOW = 48; // lumLevels: logo fica abaixo (mesmo com anti-alias)
const LUM_HIGH = 150; // foto (inclusive P&B) fica acima
const LUMCOV_HIGH = 0.92; // lumCoverage: logo (chapado) fica acima
const LUMCOV_LOW = 0.6; // foto espalha pelos bins
const SOFT_LOW = 0.3; // softRatio: logo fica abaixo
const SOFT_HIGH = 0.6; // foto fica acima
const DIFF_FLAT = 4; // |diff| < 4 → área plana (ignorada na razão)
const DIFF_SOFT = 28; // 4..28 → gradiente suave; >28 → borda dura

/**
 * Confiança mínima da heurística pra dispensar a IA de visão.
 *
 * Alto de propósito. A 0.75 a heurística classificava um render de cartoon
 * (Mickey, com sombreado suave e gradiente no calçado/short) como FOTO com
 * confiança 0.89 — e como 0.89 > 0.75, a IA nunca era consultada, apesar do
 * `AI_PROMPT` dizer explicitamente "cartoon ou desenho flat → LOGO". O
 * `softRatio` pesa 45% e gradiente suave é o sinal mais forte de tom contínuo,
 * então arte ilustrada com sombreado cai sistematicamente do lado errado.
 *
 * A 0.92, só o atalho de arte binária pura (0.95) e os extremos dispensam a IA;
 * o resto vai pro desempate. O custo é irrelevante perto do que ele protege:
 * ~1s e uma chamada de 5 tokens ANTES de uma geração de imagem de 15–20s que
 * sairia com o prompt errado.
 */
export const AI_GATE = 0.92;
const AI_TIMEOUT_MS = 8_000;
const VISION_MODEL =
	process.env.OPENROUTER_VISION_MODEL ?? 'google/gemini-2.5-flash-lite';

const AI_PROMPT = `Classifique a imagem para escolher um pipeline de gravação a laser.
Responda com UMA única palavra: FOTO ou LOGO.

FOTO = imagem de tom contínuo: fotografia real (pessoa, pet, paisagem, objeto, cena), retrato realista, pintura ou render com sombreamento suave e gradientes.
LOGO = arte gráfica chapada: logotipo, brasão, ícone, ilustração vetorial, desenho de linha, texto/lettering, clipart, estêncil, screenshot de arte.

Casos limite:
- Foto de um logo impresso numa parede/objeto, onde a cena (perspectiva, textura, iluminação) domina → FOTO. Scan ou foto frontal onde a imagem é essencialmente a arte gráfica em si → LOGO.
- Cartoon ou desenho flat de pessoa/animal → LOGO.
- Foto em preto e branco → FOTO.

Responda apenas FOTO ou LOGO, sem pontuação.`;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Heurística por métricas de cor/gradiente. Nunca chama rede.
 *
 * O resize usa kernel NEAREST de propósito: preserva a dureza das bordas do
 * logo (sem a banda de suavização do lanczos) e mantém os micro-gradientes da
 * foto — senão o `softRatio` dos logos infla e o discriminador perde força.
 */
export async function heuristicClassify(
	buffer: Buffer,
): Promise<Omit<ClassifyResult, 'source'>> {
	const { data, info } = await sharp(buffer, { failOn: 'none' })
		.flatten({ background: '#ffffff' })
		.resize(96, 96, {
			fit: 'inside',
			withoutEnlargement: true,
			kernel: 'nearest',
		})
		// Força 3 canais. Sem isto, um PNG em escala de cinza chega com
		// `channels: 1` e a leitura de r/g/b pega o PIXEL SEGUINTE em vez dos
		// canais — corrompendo todas as métricas exatamente no caso "foto P&B".
		.toColourspace('srgb')
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const W = info.width;
	const H = info.height;
	const ch = info.channels;
	const N = W * H;

	// Cores quantizadas (4 bits/canal), níveis e bins de luminância.
	const colorCounts = new Map<number, number>();
	const lum = new Float32Array(N);
	const lumSeen = new Uint8Array(256);
	const lumBins = new Uint32Array(32);
	let bilevel = 0;
	for (let i = 0; i < N; i++) {
		const r = data[i * ch];
		const g = data[i * ch + 1];
		const b = data[i * ch + 2];
		const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
		colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
		const l = 0.299 * r + 0.587 * g + 0.114 * b;
		lum[i] = l;
		const li = Math.min(255, Math.round(l));
		lumSeen[li] = 1;
		lumBins[li >> 3]++;
		if (l < 20 || l > 235) bilevel++;
	}
	const uniqueColors = colorCounts.size;
	let lumLevels = 0;
	for (let i = 0; i < 256; i++) lumLevels += lumSeen[i];
	const top6 = [...lumBins].sort((a, b) => b - a).slice(0, 6);
	const lumCoverage = top6.reduce((s, v) => s + v, 0) / N;
	const bilevelRatio = bilevel / N;

	// Razão de gradientes suaves vs bordas duras (vizinho à direita e abaixo).
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

	const metrics: ClassifyMetrics = {
		uniqueColors,
		lumLevels,
		lumCoverage,
		softRatio,
		bilevelRatio,
	};

	// Arte P&B já pronta (estêncil/line art): logo com alta confiança.
	if (bilevelRatio >= 0.97 && uniqueColors < 20) {
		return { kind: 'logo', confidence: 0.95, metrics };
	}

	// Riqueza tonal: máximo entre cores RGB e níveis de luminância — cobre
	// FOTO P&B, onde a quantização de cor colapsa (r≈g≈b → ≤16 chaves) e uma
	// heurística só-de-cor classificaria como logo.
	const richScore = Math.max(
		clamp01((uniqueColors - COLOR_LOW) / (COLOR_HIGH - COLOR_LOW)),
		clamp01((lumLevels - LUM_LOW) / (LUM_HIGH - LUM_LOW)),
	);
	const coverageScore = clamp01(
		(LUMCOV_HIGH - lumCoverage) / (LUMCOV_HIGH - LUMCOV_LOW),
	);
	const softScore = clamp01((softRatio - SOFT_LOW) / (SOFT_HIGH - SOFT_LOW));
	const photoScore = 0.3 * richScore + 0.25 * coverageScore + 0.45 * softScore;

	return {
		kind: photoScore >= 0.5 ? 'photo' : 'logo',
		confidence: clamp01(Math.abs(photoScore - 0.5) * 2),
		metrics,
	};
}

/**
 * Classificação completa: heurística e, na zona de dúvida (confiança abaixo do
 * `AI_GATE`), uma pergunta de UMA palavra a um modelo de visão barato. Qualquer
 * erro/timeout da IA cai de volta na heurística — nunca quebra a geração.
 */
export async function classifyImage(
	buffer: Buffer,
	opts?: { allowAI?: boolean },
): Promise<ClassifyResult> {
	const h = await heuristicClassify(buffer);
	if (
		h.confidence >= AI_GATE ||
		opts?.allowAI === false ||
		!process.env.OPENROUTER_API_KEY
	) {
		return { ...h, source: 'heuristic' };
	}

	try {
		const small = await sharp(buffer, { failOn: 'none' })
			.flatten({ background: '#ffffff' })
			.resize(384, 384, { fit: 'inside', withoutEnlargement: true })
			.jpeg({ quality: 70 })
			.toBuffer();

		const completion = await openrouter.chat.completions.create(
			{
				model: VISION_MODEL,
				messages: [
					{
						role: 'user',
						content: [
							{
								type: 'image_url',
								image_url: {
									url: `data:image/jpeg;base64,${small.toString('base64')}`,
								},
							},
							{ type: 'text', text: AI_PROMPT },
						],
					},
				],
				temperature: 0,
				max_tokens: 5,
				// biome-ignore lint/suspicious/noExplicitAny: conteúdo multimodal OpenRouter
			} as any,
			{
				signal: AbortSignal.timeout(AI_TIMEOUT_MS),
				headers: {
					'HTTP-Referer':
						process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
					'X-Title': `${process.env.NEXT_PUBLIC_COMPANY_SYSTEM ?? 'Profissão Laser'} - Vetorização`,
				},
			},
		);

		const raw = completion.choices?.[0]?.message?.content ?? '';
		const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
		const up = text.toUpperCase();
		const kind = up.includes('FOTO')
			? 'photo'
			: up.includes('LOGO')
				? 'logo'
				: null;
		if (!kind) throw new Error(`Resposta inesperada da IA: ${text}`);
		return { kind, confidence: 0.9, source: 'ai', metrics: h.metrics };
	} catch {
		return { ...h, source: 'heuristic-fallback' };
	}
}
