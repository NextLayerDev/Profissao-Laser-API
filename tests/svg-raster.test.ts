import { describe, expect, it } from 'vitest';
import { normalizeSvgForRaster, readViewBox } from '@/lib/svg-raster.js';

describe('readViewBox', () => {
	it('lê x/y/w/h do viewBox', () => {
		expect(readViewBox('<svg viewBox="0 0 150 150">')).toEqual({
			x: 0,
			y: 0,
			w: 150,
			h: 150,
		});
	});

	it('null sem viewBox ou com w/h inválidos', () => {
		expect(readViewBox('<svg width="10">')).toBeNull();
		expect(readViewBox('<svg viewBox="0 0 0 10">')).toBeNull();
	});
});

describe('normalizeSvgForRaster', () => {
	it('insere width/height na tag <svg> raiz quando ausentes, sem tocar filhos', () => {
		// Regressão: o regex de width/height NÃO pode casar o primeiro
		// width="..."/height="..." de QUALQUER elemento — um <svg> raiz sem
		// dimensões próprias (só viewBox) e um filho com width/height (ex.:
		// <rect>) fazia o valor do filho ser SOBRESCRITO com o do viewBox,
		// corrompendo a forma silenciosamente antes de rasterizar.
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 150">' +
			'<rect x="20" y="20" width="110" height="110" fill="black"/></svg>';
		const out = normalizeSvgForRaster(svg);

		expect(out).toContain('<rect x="20" y="20" width="110" height="110"');
		const svgTag = out.match(/<svg\b[^>]*>/i)?.[0] ?? '';
		expect(svgTag).toMatch(/\bwidth="150"/);
		expect(svgTag).toMatch(/\bheight="150"/);
	});

	it('reescreve width/height já presentes na raiz (ex.: mm) pro sistema do viewBox', () => {
		// Comportamento documentado: applySvgDimensions grava width/height em mm
		// deixando o viewBox em px — normalizeSvgForRaster tem que reverter isso
		// pra rasterização não sair em escala errada.
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="83.5mm" height="83.5mm" viewBox="0 0 1600 1600">' +
			'<path d="M0 0L1600 0L1600 1600L0 1600Z"/></svg>';
		const out = normalizeSvgForRaster(svg);
		const svgTag = out.match(/<svg\b[^>]*>/i)?.[0] ?? '';
		expect(svgTag).toMatch(/\bwidth="1600"/);
		expect(svgTag).toMatch(/\bheight="1600"/);
	});

	it('sem viewBox, devolve o SVG intacto', () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
		expect(normalizeSvgForRaster(svg)).toBe(svg);
	});
});
