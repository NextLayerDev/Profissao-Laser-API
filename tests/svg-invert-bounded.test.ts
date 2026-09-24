import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { invertSvgBoundedBySilhouette } from '@/lib/svg-invert-bounded.js';
import { rasterizeSvgToPng } from '@/lib/svg-raster.js';
import { svgToDxf } from '@/lib/vectorize.js';

/**
 * O teste-síntese do requisito: o INVERTIDO delimitado pela silhueta nunca
 * pode pintar o retângulo do viewBox — cantos do quadro têm que sair BRANCOS,
 * e a região invertida tem que abraçar a arte com um anel fino.
 */

// Donut quadrado: anel 20..120 com furo ENCLOSED 50..90, viewBox 150×150 —
// mesmo formato que o Potrace emite (um path evenodd).
const DONUT =
	'<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">' +
	'<path fill="#000000" fill-rule="evenodd" d="M20 20H120V120H20Z M50 50H90V90H50Z"/></svg>';

async function rasterize(svg: string) {
	const png = await rasterizeSvgToPng(svg, { maxDim: 800, flattenWhite: true });
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

describe('invertSvgBoundedBySilhouette', () => {
	it('donut: compound path único, moldura NÃO é o retângulo do viewBox, arte preservada', async () => {
		const res = await invertSvgBoundedBySilhouette(DONUT);
		expect(res.ok).toBe(true);
		if (res.ok === false) return;

		expect(res.strategy).toBe('vector');
		expect(res.svg.match(/<path\b/g)).toHaveLength(1);
		expect(res.svg).toContain('fill-rule="evenodd"');

		const d = res.svg.match(/\bd="([^"]+)"/)?.[1] ?? '';
		// A moldura do viewBox inteiro é exatamente o que NÃO pode existir mais.
		expect(d.startsWith('M0 0H150V150H0Z')).toBe(false);
		// Os `d` ORIGINAIS entram intactos como furos (lossless).
		expect(d).toContain('M20 20H120V120H20Z M50 50H90V90H50Z');
	});

	it('donut rasterizado: cantos brancos, furo enclosed invertido, anel fino colado na arte', async () => {
		const res = await invertSvgBoundedBySilhouette(DONUT);
		if (res.ok === false) throw new Error('esperava sucesso');
		const { W, at } = await rasterize(res.svg);
		const s = W / 150;

		// Fundo de verdade (fora da silhueta) fica branco — sem quadrado preto.
		expect(at(Math.round(5 * s), Math.round(5 * s))).toBeGreaterThan(200);
		expect(at(W - 3, 3)).toBeGreaterThan(200);
		// A tinta original vira furo (branco).
		expect(at(Math.round(30 * s), Math.round(70 * s))).toBeGreaterThan(200);
		// O furo enclosed (50..90) fica DENTRO da moldura → invertido (preto).
		expect(at(Math.round(70 * s), Math.round(70 * s))).toBeLessThan(60);

		// Anel fino: vindo da esquerda na linha do meio, o primeiro pixel preto
		// aparece logo ANTES da arte (x=20) — nem no x=0 (retângulo), nem depois.
		const y = Math.round(70 * s);
		let firstDark = -1;
		for (let x = 0; x < W; x++) {
			if (at(x, y) < 60) {
				firstDark = x;
				break;
			}
		}
		expect(firstDark).toBeGreaterThan(Math.round(14 * s));
		expect(firstDark).toBeLessThanOrEqual(Math.round(20 * s) + 1);
	});

	it('dois blobs distantes: cada um ganha o próprio anel — sem ponte nem retângulo', async () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">' +
			'<rect x="300" y="300" width="200" height="200" fill="black"/>' +
			'<rect x="20" y="20" width="80" height="80" fill="black"/>' +
			'</svg>';
		const res = await invertSvgBoundedBySilhouette(svg);
		expect(res.ok).toBe(true);
		if (res.ok === false) return;

		const { W, at } = await rasterize(res.svg);
		const s = W / 800;
		// Cantos e o vão entre os blobs: brancos.
		expect(at(W - 3, 3)).toBeGreaterThan(200);
		expect(at(Math.round(200 * s), Math.round(600 * s))).toBeGreaterThan(200);
		// Interior dos blobs (era tinta) vira furo branco.
		expect(at(Math.round(400 * s), Math.round(400 * s))).toBeGreaterThan(200);
		expect(at(Math.round(60 * s), Math.round(60 * s))).toBeGreaterThan(200);

		// O anel do blob grande começa colado nele (perto de x=300), não em x=0.
		const y = Math.round(400 * s);
		let firstDark = -1;
		for (let x = 0; x < W; x++) {
			if (at(x, y) < 60) {
				firstDark = x;
				break;
			}
		}
		expect(firstDark).toBeGreaterThan(Math.round(280 * s));
		expect(firstDark).toBeLessThanOrEqual(Math.round(300 * s) + 1);
	});

	it('transform → estratégia retraced (rasteriza em vez de recusar), sem retângulo', async () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">' +
			'<g transform="translate(5,5)"><path d="M20 20H110V110H20Z" fill="#000000"/></g></svg>';
		const res = await invertSvgBoundedBySilhouette(svg);
		expect(res.ok).toBe(true);
		if (res.ok === false) return;
		expect(res.strategy).toBe('retraced');

		const { W, at } = await rasterize(res.svg);
		const s = W / 150;
		expect(at(3, 3)).toBeGreaterThan(200); // canto branco
		// Interior da arte transformada (25..115) vira furo branco.
		expect(at(Math.round(70 * s), Math.round(70 * s))).toBeGreaterThan(200);
	});

	it('recusas: multicolor, <image> embutida e SVG sem geometria', async () => {
		const multi =
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
			'<path d="M0 0L50 0L50 50L0 50Z" fill="#ff0000"/>' +
			'<path d="M50 50L100 50L100 100L50 100Z" fill="#0000ff"/></svg>';
		expect(await invertSvgBoundedBySilhouette(multi)).toEqual({
			ok: false,
			reason: 'multicolor',
		});

		const image =
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
			'<image x="0" y="0" width="100" height="100" href="data:image/png;base64,AAAA"/></svg>';
		expect(await invertSvgBoundedBySilhouette(image)).toEqual({
			ok: false,
			reason: 'no_geometry',
		});

		const empty =
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
		expect(await invertSvgBoundedBySilhouette(empty)).toEqual({
			ok: false,
			reason: 'no_geometry',
		});
	});

	it('DXF do invertido: moldura + os subpaths originais, nenhum arco', async () => {
		const res = await invertSvgBoundedBySilhouette(DONUT);
		if (res.ok === false) throw new Error('esperava sucesso');
		const dxf = svgToDxf(res.svg);
		// 2 subpaths do donut + ≥1 da moldura traçada.
		expect((dxf.match(/LWPOLYLINE/g) ?? []).length).toBeGreaterThanOrEqual(3);
	});
});
