import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { classifyImage, heuristicClassify } from '@/lib/image-classify.js';

const DIM = 128;

/** Imagem RGB sintética a partir de uma função de pixel. */
async function rgb(
	fn: (x: number, y: number) => [number, number, number],
	w = DIM,
	h = DIM,
): Promise<Buffer> {
	const data = Buffer.alloc(w * h * 3);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const [r, g, b] = fn(x, y);
			const i = (y * w + x) * 3;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
		}
	}
	return sharp(data, { raw: { width: w, height: h, channels: 3 } })
		.png()
		.toBuffer();
}

/** Imagem em ESCALA DE CINZA de verdade (1 canal no PNG). */
async function gray(
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

describe('heuristicClassify', () => {
	it('arte chapada de 3 cores → logo', async () => {
		// Luminâncias bem separadas de propósito: cores chapadas ADJACENTES com
		// luminância próxima (diff 4..28) contam como "gradiente suave", e numa
		// imagem com só 2 bordas isso domina o softRatio. Num logo real há muitas
		// bordas e o efeito dilui — mas o teste precisa ser inequívoco.
		const img = await rgb((x) =>
			x < 42 ? [180, 0, 0] : x < 84 ? [100, 180, 255] : [250, 250, 250],
		);
		const r = await heuristicClassify(img);
		expect(r.kind).toBe('logo');
		expect(r.confidence).toBeGreaterThan(0.5);
	});

	it('gradiente RGB suave → photo', async () => {
		const img = await rgb((x, y) => [
			Math.round((x / DIM) * 255),
			Math.round((y / DIM) * 255),
			Math.round(((x + y) / (2 * DIM)) * 255),
		]);
		const r = await heuristicClassify(img);
		expect(r.kind).toBe('photo');
	});

	it('degradê em ESCALA DE CINZA → photo (regressão: quantização de cor colapsa)', async () => {
		// Só 16 chaves de cor quantizada (r≈g≈b), então uma heurística baseada em
		// cor chamaria de logo. O richScore usa max(cores, níveis de luminância)
		// justamente pra isso. Também exercita o caminho PNG de 1 canal.
		const img = await gray((x, y) => Math.round(((x + y) / (2 * DIM)) * 255));
		const r = await heuristicClassify(img);
		expect(r.metrics?.uniqueColors).toBeLessThanOrEqual(20);
		expect(r.metrics?.lumLevels).toBeGreaterThan(60);
		expect(r.kind).toBe('photo');
	});

	it('arte binária pura → logo pelo atalho do bilevelRatio', async () => {
		const img = await rgb((x, y) => {
			const on = x > 20 && x < 100 && y > 40 && y < 60;
			return on ? [0, 0, 0] : [255, 255, 255];
		});
		const r = await heuristicClassify(img);
		expect(r.kind).toBe('logo');
		expect(r.confidence).toBe(0.95);
		expect(r.metrics?.bilevelRatio).toBeGreaterThanOrEqual(0.97);
	});
});

describe('classifyImage', () => {
	it('com allowAI: false nunca chama rede e reporta source heuristic', async () => {
		const img = await rgb((x) => (x < 64 ? [0, 0, 0] : [255, 255, 255]));
		const r = await classifyImage(img, { allowAI: false });
		expect(r.source).toBe('heuristic');
		expect(['photo', 'logo']).toContain(r.kind);
	});
});
