import { describe, expect, it } from 'vitest';
import {
	closeSquare,
	computeSilhouetteMask,
	dilateSquare,
	encodeMaskToPng,
	erodeSquare,
	fillHoles,
	sealAgainstEdges,
	silhouetteMaskPng,
} from '@/lib/svg-negative.js';
import { rasterizeSvgToInkMask } from '@/lib/svg-raster.js';

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

describe('chooseInvertMode — sinal de complexidade (subpaths)', () => {
	it('line-art densa de traço médio (sobrevive à erosão, mas com centenas de subpaths) → silhueta', async () => {
		const { chooseInvertMode } = await import('@/lib/svg-negative.js');
		// Retrato real medido: 1548 subpaths, survivalErode2=0,59 (bem acima do
		// limiar de 0,25 que pega hachura FINA) — sem o sinal de complexidade,
		// esse tipo de ilustração caía em 'geometric' e reproduzia o mesmo
		// "fundo quase sólido cheio de furinhos" que o subject='photo' existe
		// pra evitar. Sintético aqui: 250 blocos de 6×6 (grossos o bastante pra
		// sobreviver à erosão), muitos subpaths.
		let shapes = '';
		for (let i = 0; i < 250; i++) {
			const x = 10 + (i % 25) * 20;
			const y = 10 + Math.floor(i / 25) * 20;
			shapes += `<rect x="${x}" y="${y}" width="6" height="6" fill="black"/>`;
		}
		const denseLineArt = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="220" viewBox="0 0 520 220">${shapes}</svg>`;

		expect(await chooseInvertMode(denseLineArt)).toBe('silhouette');
	});

	it('logo simples (poucos subpaths, formas sólidas) → geométrico', async () => {
		const { chooseInvertMode } = await import('@/lib/svg-negative.js');
		const simpleLogo =
			'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">' +
			'<rect x="20" y="20" width="160" height="160" fill="black"/>' +
			'<rect x="70" y="70" width="60" height="60" fill="black"/></svg>';

		expect(await chooseInvertMode(simpleLogo)).toBe('geometric');
	});
});

describe('computeSilhouetteMask (extraída de silhouetteMaskPng)', () => {
	it('silhouetteMaskPng continua usando o pipeline rasterize→computeSilhouetteMask→encode', async () => {
		// Regressão da extração: silhouetteMaskPng() precisa continuar batendo
		// bit a bit com chamar as peças separadamente — é o mesmo contrato de
		// antes, só reorganizado pra buildSilhouetteContourSvg reaproveitar a
		// máscara de tinta original (`ink`), que silhouetteMaskPng descarta.
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
			'<rect x="10" y="10" width="20" height="20" fill="black"/></svg>';

		const { ink, width, height } = await rasterizeSvgToInkMask(svg, 64);
		const expectedMask = computeSilhouetteMask(ink, width, height);
		const expectedPng = await encodeMaskToPng(expectedMask, width, height);

		const { png, width: w2, height: h2 } = await silhouetteMaskPng(svg, 64);
		expect(w2).toBe(width);
		expect(h2).toBe(height);
		expect(Buffer.compare(png, expectedPng)).toBe(0);
	});

	/**
	 * Duas "mechas" quase-paralelas (diagonais, staircase de baixa inclinação,
	 * o padrão real de cabelo fino) com um vão de 18px entre elas, numa tela
	 * 100×100. Valores medidos diretamente (não chutados): com o `closeR`
	 * pequeno (comparável ao default ~1% da menor dimensão) o vão NÃO fecha;
	 * só um `closeR` bem maior (a retentativa de `buildSilhouetteContourSvg`)
	 * funde as duas mechas num miolo sólido. É o mecanismo exato que a
	 * retentativa depende — se ele parar de funcionar aqui, a retentativa
	 * também para de funcionar contra "caso 1".
	 */
	it('vão largo entre mechas finas não fecha com closeR pequeno, mas fecha com closeR maior', () => {
		const W = 100;
		const H = 100;
		const GAP = 18;
		const ink = new Uint8Array(W * H);
		for (let y = 5; y < H - 10; y++) {
			const x1 = 20 + Math.floor(y * 0.3);
			const x2 = x1 + GAP;
			if (x1 >= 0 && x1 < W) ink[y * W + x1] = 1;
			if (x2 >= 0 && x2 < W) ink[y * W + x2] = 1;
		}
		const probeY = 50;
		const probeX = 20 + Math.floor(probeY * 0.3) + Math.round(GAP / 2);

		const small = computeSilhouetteMask(ink, W, H, { closeR: 2 });
		expect(small[probeY * W + probeX]).toBe(0);

		const big = computeSilhouetteMask(ink, W, H, { closeR: 8 });
		expect(big[probeY * W + probeX]).toBe(1);
	});

	/**
	 * Análogo sintético do bug real (pá de remo cruzado parcialmente fora do
	 * contorno calculado): um blob sólido principal + poeira de pixels isolados
	 * longe demais pra fechar com qualquer `closeR` razoável. Serve de fixture
	 * pro detector de fragmentação/vazamento de `buildSilhouetteContourSvg`
	 * (tests/svg-silhouette-contour.test.ts) — com essa máscara, o contorno
	 * traçado do blob principal não cobre os pixels isolados, e a contagem de
	 * subpaths dispara.
	 */
	it('poeira isolada longe do blob principal não é absorvida (fixture adversarial)', () => {
		const W = 120;
		const H = 120;
		const ink = new Uint8Array(W * H);
		for (let y = 40; y < 80; y++) {
			for (let x = 40; x < 80; x++) ink[y * W + x] = 1;
		}
		const specks: Array<[number, number]> = [
			[10, 10],
			[105, 15],
			[15, 105],
			[105, 105],
		];
		for (const [x, y] of specks) ink[y * W + x] = 1;

		const sil = computeSilhouetteMask(ink, W, H, { closeR: 2 });
		// miolo do blob principal preenchido
		expect(sil[60 * W + 60]).toBe(1);
		// poeira isolada continua isolada, não fundida ao blob nem apagada
		for (const [x, y] of specks) expect(sil[y * W + x]).toBe(1);
		// e o entorno imediato da poeira continua vazio (não virou um blob maior)
		expect(sil[10 * W + 30]).toBe(0);
	});
});
