import { describe, expect, it } from 'vitest';
import { invertSvgPolarity, readSvgGeometry } from '@/lib/svg-invert.js';
import { svgToDxf } from '@/lib/vectorize.js';

/** Formato exato que o Potrace emite em modo trace. */
const potraceSvg = (
	d = 'M10 10L90 10L90 90L10 90Z',
	fill = '#000000',
	viewBox = '0 0 100 100',
) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="${viewBox}" version="1.1">\n\t<path d="${d}" stroke="none" fill="${fill}" fill-rule="evenodd"/>\n</svg>`;

const paths = (svg: string) => svg.match(/<path\b/g) ?? [];
const firstD = (svg: string) => svg.match(/\bd="([^"]+)"/)?.[1] ?? '';

describe('invertSvgPolarity — complemento geométrico', () => {
	it('vira um único compound path evenodd, com a moldura primeiro', () => {
		const original = 'M10 10L90 10L90 90L10 90Z';
		const out = invertSvgPolarity(potraceSvg(original));
		expect('svg' in out).toBe(true);
		if (!('svg' in out)) return;

		expect(paths(out.svg)).toHaveLength(1);
		expect(out.svg).toContain('fill-rule="evenodd"');

		const d = firstD(out.svg);
		// Moldura do viewBox abre o path; a arte vira furo logo em seguida.
		expect(d.startsWith('M0 0H100V100H0Z')).toBe(true);
		expect(d).toContain(original);
	});

	it('preserva a cor de tinta detectada', () => {
		const out = invertSvgPolarity(potraceSvg(undefined, '#ff0000'));
		if (!('svg' in out)) throw new Error('esperava sucesso');
		expect(out.svg).toContain('fill="#ff0000"');
	});

	it('recusa multi-cor (modo cores / posterize)', () => {
		const multi = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
			<path d="M0 0L50 0L50 50L0 50Z" fill="#ff0000"/>
			<path d="M50 50L100 50L100 100L50 100Z" fill="#0000ff"/>
		</svg>`;
		expect(invertSvgPolarity(multi)).toEqual({ error: 'multicolor' });
	});

	it('recusa transform em vez de transformar errado em silêncio', () => {
		const tx = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
			<g transform="translate(5,5)"><path d="M0 0L10 0L10 10Z" fill="#000"/></g>
		</svg>`;
		expect(invertSvgPolarity(tx)).toEqual({ error: 'transform' });
	});

	it('ignora paths dentro de <clipPath> (SVG com linePattern)', () => {
		const withClip = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
			<defs>
				<clipPath id="shapeClip"><path d="M1 1L2 2L3 3Z"/></clipPath>
			</defs>
			<path d="M10 10L90 10L90 90Z" fill="#000000"/>
		</svg>`;
		const out = invertSvgPolarity(withClip);
		if (!('svg' in out)) throw new Error('esperava sucesso');
		// O `d` do clip não pode aparecer na arte invertida.
		expect(firstD(out.svg)).not.toContain('M1 1L2 2L3 3Z');
		expect(firstD(out.svg)).toContain('M10 10L90 10L90 90Z');
	});

	it('usa o viewBox em px, não o width em mm', () => {
		// applySvgDimensions reescreve width/height p/ mm e deixa o viewBox em px.
		const mm = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 800 400">
			<path d="M10 10L20 20Z" fill="#000000"/>
		</svg>`;
		const out = invertSvgPolarity(mm);
		if (!('svg' in out)) throw new Error('esperava sucesso');
		expect(firstD(out.svg).startsWith('M0 0H800V400H0Z')).toBe(true);
	});

	it('sem viewBox, cai na bounding box da arte (não chuta 100×100)', () => {
		const noVb = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M100 200L300 200L300 400Z" fill="#000"/></svg>`;
		const geo = readSvgGeometry(noVb);
		expect(geo).not.toBeNull();
		if (!geo) return;
		// Envolve a arte com ~1% de margem — nada perto de 0 0 100 100.
		expect(geo.x).toBeLessThan(100);
		expect(geo.x).toBeGreaterThan(90);
		expect(geo.w).toBeGreaterThan(200);
		expect(geo.h).toBeGreaterThan(200);
	});

	it('SVG sem geometria → no_geometry', () => {
		const empty = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>`;
		expect(invertSvgPolarity(empty)).toEqual({ error: 'no_geometry' });
	});

	it('converte <circle> em cúbicas (o parser de DXF não trata arcos)', () => {
		const circle = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="20" fill="#000"/></svg>`;
		const out = invertSvgPolarity(circle);
		if (!('svg' in out)) throw new Error('esperava sucesso');
		const d = firstD(out.svg);
		expect(d).toContain('C'); // cúbicas
		expect(d).not.toMatch(/[Aa]\d/); // nenhum comando de arco
	});

	it('DXF do invertido = subpaths do original + a moldura', () => {
		const original = potraceSvg('M10 10L90 10L90 90L10 90Z');
		const out = invertSvgPolarity(original);
		if (!('svg' in out)) throw new Error('esperava sucesso');

		const count = (dxf: string) => (dxf.match(/LWPOLYLINE/g) ?? []).length;
		expect(count(svgToDxf(out.svg))).toBe(count(svgToDxf(original)) + 1);
	});
});
