import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildSilhouetteContourSvg } from '@/lib/svg-silhouette-contour.js';

async function decodeEmbeddedPng(svg: string) {
	const b64 = svg.match(/href="data:image\/png;base64,([^"]+)"/)?.[1];
	if (!b64) throw new Error('SVG não tem <image> embutida');
	const png = Buffer.from(b64, 'base64');
	const { data, info } = await sharp(png)
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return {
		W: info.width,
		H: info.height,
		at: (x: number, y: number) => data[y * info.width + x],
	};
}

// Quadro: quadrado externo (20..120) com um buraco interno ENCLOSED (50..90),
// num único path evenodd — viewBox 150×150. O buraco (branco) fica cercado de
// tinta em todos os lados, então a reconstrução morfológica o inclui na
// silhueta (fillHoles) mesmo sendo originalmente fundo.
const FRAME =
	'<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">' +
	'<path fill="#000000" fill-rule="evenodd" d="M20 20H120V120H20Z M50 50H90V90H50Z"/></svg>';

describe('buildSilhouetteContourSvg', () => {
	it('inverte os tons só DENTRO da silhueta; fundo verdadeiro fica intacto', async () => {
		const res = await buildSilhouetteContourSvg(FRAME);
		expect(res.ok).toBe(true);
		if (res.ok === false) return;

		expect(res.svg).toContain('<image');
		expect(res.svg).not.toContain('<path');

		const { W, H, at } = await decodeEmbeddedPng(res.svg);
		const scale = W / 150;
		// Área que era preta (tinta do quadro) — invertida, agora clara.
		expect(at(Math.round(30 * scale), Math.round(30 * scale))).toBeGreaterThan(
			200,
		);
		// Buraco interno (era fundo/branco, mas ENCLOSED pela tinta) — a
		// silhueta o inclui, então também inverte: agora escuro. É o mecanismo
		// que preserva detalhe fino (ex.: mechas de cabelo) em vez de perdê-lo.
		expect(at(Math.round(70 * scale), Math.round(70 * scale))).toBeLessThan(60);
		// Fora do quadro inteiro — fundo de verdade, nunca fez parte da
		// silhueta — permanece exatamente como no original (branco).
		expect(at(Math.round(5 * scale), Math.round(5 * scale))).toBeGreaterThan(
			200,
		);
		expect(H).toBe(W); // viewBox quadrado
	});

	it('blob principal + pedaço isolado e distante (não funde nem com retentativa): recusa fragmentado', async () => {
		// Bloco de 80×80 a 280px de distância do blob principal (200×200) numa
		// tela de 800×800 — bem além do que qualquer closeR razoável (mesmo com
		// a retentativa) fecharia. Análogo sintético de um acessório que ficou
		// solto demais da silhueta principal pra fundir.
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">' +
			'<rect x="300" y="300" width="200" height="200" fill="black"/>' +
			'<rect x="20" y="20" width="80" height="80" fill="black"/>' +
			'</svg>';

		const res = await buildSilhouetteContourSvg(svg);
		expect(res.ok).toBe(false);
		if (res.ok === true) return;
		expect(res.reason).toBe('fragmented');
	});

	it('SVG sem geometria preenchível: recusa com no_geometry', async () => {
		const res = await buildSilhouetteContourSvg(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
		);
		expect(res.ok).toBe(false);
		if (res.ok === true) return;
		expect(res.reason).toBe('no_geometry');
	});

	it('sem tinta de verdade (só fill branco): recusa com empty', async () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">' +
			'<rect x="0" y="0" width="50" height="50" fill="#ffffff"/></svg>';
		const res = await buildSilhouetteContourSvg(svg);
		expect(res.ok).toBe(false);
		if (res.ok === true) return;
		expect(res.reason).toBe('empty');
	});
});
