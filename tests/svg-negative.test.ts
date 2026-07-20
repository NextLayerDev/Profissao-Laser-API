import { describe, expect, it } from 'vitest';
import {
	closeSquare,
	dilateSquare,
	erodeSquare,
	fillHoles,
	sealAgainstEdges,
} from '@/lib/svg-negative.js';

// ─── Referência ingênua: 3×3 repetido r vezes (o algoritmo original) ──
// A versão de produção usa morfologia separável com janela corrente, O(N) e
// independente de r. Estes testes são a guarda dessa reescrita.

function naiveDilatePass(src: Uint8Array, W: number, H: number): Uint8Array {
	const out = new Uint8Array(W * H);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			let v = 0;
			for (let dy = -1; dy <= 1 && v === 0; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx;
					const ny = y + dy;
					if (
						nx >= 0 &&
						ny >= 0 &&
						nx < W &&
						ny < H &&
						src[ny * W + nx] === 1
					) {
						v = 1;
						break;
					}
				}
			}
			out[y * W + x] = v;
		}
	}
	return out;
}

function naiveErodePass(src: Uint8Array, W: number, H: number): Uint8Array {
	const out = new Uint8Array(W * H);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			let v = 1;
			for (let dy = -1; dy <= 1 && v === 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx;
					const ny = y + dy;
					const fg =
						nx >= 0 && ny >= 0 && nx < W && ny < H && src[ny * W + nx] === 1;
					if (!fg) {
						v = 0;
						break;
					}
				}
			}
			out[y * W + x] = v;
		}
	}
	return out;
}

const naiveRepeat = (
	m: Uint8Array,
	W: number,
	H: number,
	r: number,
	pass: (s: Uint8Array, w: number, h: number) => Uint8Array,
) => {
	let d = m;
	for (let i = 0; i < r; i++) d = pass(d, W, H);
	return d;
};

/** PRNG determinístico — sem Math.random pra o teste ser reproduzível. */
function seeded(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0x100000000;
	};
}

function randomMask(W: number, H: number, density: number, seed: number) {
	const rnd = seeded(seed);
	const m = new Uint8Array(W * H);
	for (let i = 0; i < m.length; i++) m[i] = rnd() < density ? 1 : 0;
	return m;
}

describe('morfologia separável ≡ 3×3 repetido', () => {
	const W = 37;
	const H = 29; // dimensões não-quadradas e ímpares, pra pegar erro de borda

	for (const r of [1, 2, 3]) {
		for (const density of [0.1, 0.5, 0.85]) {
			it(`dilate r=${r} densidade=${density} bate bit a bit`, () => {
				const m = randomMask(W, H, density, 42 + r * 7 + density * 100);
				expect(Array.from(dilateSquare(m, W, H, r))).toEqual(
					Array.from(naiveRepeat(m, W, H, r, naiveDilatePass)),
				);
			});

			it(`erode r=${r} densidade=${density} bate bit a bit`, () => {
				const m = randomMask(W, H, density, 99 + r * 3 + density * 100);
				expect(Array.from(erodeSquare(m, W, H, r))).toEqual(
					Array.from(naiveRepeat(m, W, H, r, naiveErodePass)),
				);
			});
		}
	}

	it('close = dilate seguido de erode', () => {
		const m = randomMask(W, H, 0.3, 7);
		const expected = naiveRepeat(
			naiveRepeat(m, W, H, 2, naiveDilatePass),
			W,
			H,
			2,
			naiveErodePass,
		);
		expect(Array.from(closeSquare(m, W, H, 2))).toEqual(Array.from(expected));
	});

	it('r=0 é identidade', () => {
		const m = randomMask(W, H, 0.4, 3);
		expect(Array.from(dilateSquare(m, W, H, 0))).toEqual(Array.from(m));
		expect(Array.from(erodeSquare(m, W, H, 0))).toEqual(Array.from(m));
	});
});

describe('fillHoles', () => {
	it('preenche o miolo de um anel e não vaza pro exterior', () => {
		const W = 21;
		const H = 21;
		const m = new Uint8Array(W * H);
		// Anel quadrado de 5..15
		for (let y = 5; y <= 15; y++) {
			for (let x = 5; x <= 15; x++) {
				const onBorder = x === 5 || x === 15 || y === 5 || y === 15;
				if (onBorder) m[y * W + x] = 1;
			}
		}
		const out = fillHoles(m, W, H);
		expect(out[10 * W + 10]).toBe(1); // centro preenchido
		expect(out[0]).toBe(0); // canto externo intacto
		expect(out[2 * W + 10]).toBe(0); // fora do anel, intacto
	});

	it('máscara sem buraco fica igual', () => {
		const W = 10;
		const H = 10;
		const m = new Uint8Array(W * H);
		m[5 * W + 5] = 1;
		expect(Array.from(fillHoles(m, W, H))).toEqual(Array.from(m));
	});
});

describe('sealAgainstEdges', () => {
	it('faz a ponte entre colunas que ALCANÇAM a borda', () => {
		const W = 20;
		const H = 20;
		const ink = new Uint8Array(W * H);
		// Colunas que chegam ATÉ a borda: figura genuinamente cortada pelo
		// enquadramento, que é o caso para o qual o selo existe.
		for (let y = 5; y < H; y++) {
			ink[y * W + 6] = 1;
			ink[y * W + 13] = 1;
		}
		const sealed = sealAgainstEdges(ink, W, H, 6, 10);
		expect(sealed[(H - 1) * W + 10]).toBe(1);
		expect(sealed[(H - 1) * W + 1]).toBe(0);
	});

	it('NÃO escora borda que a tinta apenas se APROXIMA', () => {
		const W = 20;
		const H = 20;
		const ink = new Uint8Array(W * H);
		// Tinta para 3px antes da borda: há margem, ainda que `depth` a alcance.
		// Sem esta trava o selo escora as 4 bordas, o fillHoles preenche tudo e a
		// silhueta vira o QUADRO INTEIRO — o retângulo preto no lugar do contorno.
		for (let y = 5; y < H - 3; y++) {
			ink[y * W + 6] = 1;
			ink[y * W + 13] = 1;
		}
		expect(Array.from(sealAgainstEdges(ink, W, H, 6, 10))).toEqual(
			Array.from(ink),
		);
	});

	it('não mexe em arte com margem real em volta', () => {
		const W = 30;
		const H = 30;
		const ink = new Uint8Array(W * H);
		for (let y = 12; y < 18; y++)
			for (let x = 12; x < 18; x++) ink[y * W + x] = 1;
		// depth 4 é bem menor que a margem de 12px.
		expect(Array.from(sealAgainstEdges(ink, W, H, 4, 4))).toEqual(
			Array.from(ink),
		);
	});
});

describe('invertModeForSubject', () => {
	it('foto → silhueta, logo → geométrico', async () => {
		const { invertModeForSubject } = await import('@/lib/svg-negative.js');
		// É a fonte de verdade do modo: o tipo decidido na GERAÇÃO, não um chute
		// nos pixels do SVG. A heurística de pixels reprovava retrato hachurado
		// com pouca tinta (occ 5,6% < 8%) e caía em geométrico — que é um
		// retângulo por definição, e era o "fundo preto sem contorno" reportado.
		expect(invertModeForSubject('photo')).toBe('silhouette');
		expect(invertModeForSubject('logo')).toBe('geometric');
		// Desconhecido/ausente → null, e o chamador cai na heurística.
		expect(invertModeForSubject('color')).toBeNull();
		expect(invertModeForSubject(undefined)).toBeNull();
	});
});
