/**
 * Meio-tom por difusão de erro sobre um cinza 1-canal, para gravar o TOM da
 * foto no copo escuro (photo-negative.ts). Módulo puro: sem sharp, sem rede.
 *
 * Convenção da saída: 1 = ponto ligado (claro → grava, vira inox), 0 = apagado.
 * Varredura serpentina (linha par da esquerda para a direita, ímpar ao
 * contrário): sem ela o erro escorre sempre para o mesmo lado e o pontilhado
 * forma diagonais e "minhocas" visíveis na pele lisa.
 */

export type DiffusionKernel = 'jarvis' | 'stucki' | 'floydSteinberg';

/** [dx, dy, peso] a partir do pixel atual (dx positivo = sentido da varredura). */
const KERNELS: Record<
	DiffusionKernel,
	{ div: number; taps: ReadonlyArray<readonly [number, number, number]> }
> = {
	floydSteinberg: {
		div: 16,
		taps: [
			[1, 0, 7],
			[-1, 1, 3],
			[0, 1, 5],
			[1, 1, 1],
		],
	},
	jarvis: {
		div: 48,
		taps: [
			[1, 0, 7],
			[2, 0, 5],
			[-2, 1, 3],
			[-1, 1, 5],
			[0, 1, 7],
			[1, 1, 5],
			[2, 1, 3],
			[-2, 2, 1],
			[-1, 2, 3],
			[0, 2, 5],
			[1, 2, 3],
			[2, 2, 1],
		],
	},
	stucki: {
		div: 42,
		taps: [
			[1, 0, 8],
			[2, 0, 4],
			[-2, 1, 2],
			[-1, 1, 4],
			[0, 1, 8],
			[1, 1, 4],
			[2, 1, 2],
			[-2, 2, 1],
			[-1, 2, 2],
			[0, 2, 4],
			[1, 2, 2],
			[2, 2, 1],
		],
	},
};

export function isDiffusionKernel(v: string | undefined): v is DiffusionKernel {
	return v !== undefined && v in KERNELS;
}

/** PRNG determinístico (mulberry32): mesma foto → mesmo pontilhado. */
function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Difusão de erro (0..255 → 0/1). `skip` (opcional, 1 = fora) marca pixels que
 * não entram no meio-tom: saem 0 e não recebem nem espalham erro — o branco de
 * fora da silhueta não "empresta" claro para a borda do assunto.
 *
 * `noise` (0..128) sacode o limiar de cada pixel em ±noise: em área lisa (testa,
 * bochecha) a difusão pura cai num padrão regular de listras horizontais, que o
 * hatch horizontal do laser transforma em moiré. Semente fixa — determinístico.
 */
export function errorDiffusionDither(
	gray: ArrayLike<number>,
	w: number,
	h: number,
	kernel: DiffusionKernel = 'jarvis',
	skip?: ArrayLike<number>,
	noise = 0,
): Uint8Array {
	const { div, taps } = KERNELS[kernel];
	const err = Float32Array.from(gray as ArrayLike<number>);
	const out = new Uint8Array(w * h);
	const random = seededRandom(0x5eed);
	for (let y = 0; y < h; y++) {
		const ltr = y % 2 === 0;
		for (let i = 0; i < w; i++) {
			const x = ltr ? i : w - 1 - i;
			const idx = y * w + x;
			if (skip?.[idx]) continue;
			const v = err[idx];
			const on = v >= (noise > 0 ? 128 + (random() * 2 - 1) * noise : 128);
			if (on) out[idx] = 1;
			const e = v - (on ? 255 : 0);
			for (const [dx0, dy, wt] of taps) {
				const xx = x + (ltr ? dx0 : -dx0);
				const yy = y + dy;
				if (xx < 0 || xx >= w || yy >= h) continue;
				const j = yy * w + xx;
				if (skip?.[j]) continue;
				err[j] += (e * wt) / div;
			}
		}
	}
	return out;
}

/**
 * Rampa 0..1 que zera o tom nas bordas da IMAGEM ao longo de `ratio` do lado
 * (horizontal: da largura; vertical: da altura), com smoothstep. Onde o
 * assunto encosta na moldura (braço da selfie, peito cortado), a gravação
 * esmaece em vez de terminar numa reta. Multiplica `tone` no lugar.
 */
export function applyBorderFade(
	tone: Float32Array,
	w: number,
	h: number,
	ratio: number,
): void {
	if (ratio <= 0) return;
	const fx = Math.max(1, ratio * w);
	const fy = Math.max(1, ratio * h);
	for (let y = 0; y < h; y++) {
		const ry = Math.min(1, Math.min(y, h - 1 - y) / fy);
		for (let x = 0; x < w; x++) {
			const r = Math.min(ry, Math.min(x, w - 1 - x) / fx);
			if (r >= 1) continue;
			tone[y * w + x] *= r * r * (3 - 2 * r);
		}
	}
}
