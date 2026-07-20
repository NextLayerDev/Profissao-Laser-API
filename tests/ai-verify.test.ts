import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { verifyStructure } from '@/lib/ai-verify.js';

const DIM = 128;

/** PNG em cinza a partir de uma função de pixel. */
async function img(
	fn: (x: number, y: number) => number,
	w = DIM,
	h = DIM,
): Promise<Buffer> {
	const data = Buffer.alloc(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
	}
	return sharp(data, { raw: { width: w, height: h, channels: 1 } })
		.png()
		.toBuffer();
}

/** Arte assimétrica: blocos só no quadrante superior esquerdo. */
const asymmetric = (x: number, y: number) =>
	x < DIM / 2 && y < DIM / 2 && (x >> 3) % 2 === (y >> 3) % 2 ? 0 : 255;

/** Mesma arte repetida 2×2, como um contact sheet. */
const tiled2x2 = (x: number, y: number) =>
	asymmetric((x % (DIM / 2)) * 2, (y % (DIM / 2)) * 2);

describe('verifyStructure', () => {
	it('imagem idêntica → ok', async () => {
		const a = await img(asymmetric);
		const r = await verifyStructure(a, a);
		expect(r.reasons).toEqual([]);
		expect(r.ok).toBe(true);
	});

	it('imagem NEGADA → ainda ok (o teste é agnóstico a polaridade)', async () => {
		// Entrada com fundo escuro, redesenhada corretamente em preto-sobre-branco,
		// dá correlação fortemente NEGATIVA. Sem o Math.abs isso seria rejeitado.
		const a = await img((x, y) => ((x + y) % 64 < 32 ? 0 : 255));
		const b = await img((x, y) => ((x + y) % 64 < 32 ? 255 : 0));
		const r = await verifyStructure(a, b);
		expect(r.metrics.corr).toBeLessThan(0);
		expect(r.reasons).not.toContain('layout_mismatch');
		expect(r.ok).toBe(true);
	});

	it('saída em mosaico 2×2 → tiled_output', async () => {
		const a = await img(asymmetric);
		const b = await img(tiled2x2);
		const r = await verifyStructure(a, b);
		expect(r.reasons).toContain('tiled_output');
		expect(r.ok).toBe(false);
	});

	it('saída em branco → blank_output', async () => {
		const a = await img(asymmetric);
		const b = await img(() => 255);
		const r = await verifyStructure(a, b);
		expect(r.reasons).toContain('blank_output');
	});

	it('saída toda preta → black_output', async () => {
		const a = await img(asymmetric);
		const b = await img(() => 0);
		const r = await verifyStructure(a, b);
		expect(r.reasons).toContain('black_output');
	});

	it('figura completamente diferente → layout_mismatch', async () => {
		const bars = (horizontal: boolean) => (x: number, y: number) =>
			((horizontal ? y : x) >> 2) % 2 === 0 ? 0 : 255;
		const a = await img(bars(false));
		const b = await img(bars(true));
		const r = await verifyStructure(a, b);
		expect(r.reasons).toContain('layout_mismatch');
	});

	it('proporção trocada → aspect_changed', async () => {
		const a = await img(asymmetric, 128, 128);
		const b = await img(asymmetric, 128, 36);
		const r = await verifyStructure(a, b);
		expect(r.reasons).toContain('aspect_changed');
	});

	it('arte simétrica nos dois lados NÃO dispara tiled_output', async () => {
		// A guarda TILE_IN_MAX existe pra isto: um logo simétrico tem metades
		// auto-similares por natureza, e não pode ser confundido com uma grade.
		const checker = (x: number, y: number) =>
			(x >> 4) % 2 === (y >> 4) % 2 ? 0 : 255;
		const a = await img(checker);
		const b = await img(checker);
		const r = await verifyStructure(a, b);
		expect(r.reasons).not.toContain('tiled_output');
		expect(r.ok).toBe(true);
	});

	it('buffer indecifrável não bloqueia a entrega', async () => {
		const a = await img(asymmetric);
		const r = await verifyStructure(a, Buffer.from('nada disso é imagem'));
		expect(r.ok).toBe(true);
	});
});
