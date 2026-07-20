import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { parseVectorizeParams, vectorizeImage } from '@/lib/vectorize.js';

/**
 * Arte que ENCOSTA nas bordas esquerda, direita e inferior — é o que a IA
 * produz quase sempre (busto saindo do quadro). Sem margem branca, o Potrace
 * fecha o traçado rente ao limite da imagem em vez de contornar a figura: o
 * contorno externo sai PARTIDO em vários subpaths com vértices na borda.
 */
async function artTouchingEdges(W = 400, H = 400): Promise<Buffer> {
	const d = Buffer.alloc(W * H, 255);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const touches =
				y > 120 &&
				(x < 30 || x > W - 30 || y > H - 150 || (x > 120 && x < 280));
			if (touches) d[y * W + x] = 0;
		}
	}
	return sharp(d, { raw: { width: W, height: H, channels: 1 } })
		.png()
		.toBuffer();
}

function inspect(svg: string) {
	const d = svg.match(/\bd="([^"]+)"/)?.[1] ?? '';
	const vb = (svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 0 0')
		.split(/\s+/)
		.map(Number);
	const [, , vw, vh] = vb;
	const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
	let onEdge = 0;
	for (let i = 0; i + 1 < nums.length; i += 2) {
		const x = nums[i];
		const y = nums[i + 1];
		if (x <= 0.5 || y <= 0.5 || x >= vw - 0.5 || y >= vh - 0.5) onEdge++;
	}
	return { subpaths: (d.match(/M/g) ?? []).length, onEdge, vw, vh };
}

describe('contorno externo em arte que encosta na borda', () => {
	it('fecha num único contorno, sem vértices na borda', async () => {
		const svg = await vectorizeImage(
			await artTouchingEdges(),
			parseVectorizeParams({ mode: 'trace', threshold: '128', turdSize: '2' }),
		);
		const r = inspect(svg);
		expect(r.subpaths).toBe(1);
		expect(r.onEdge).toBe(0);
	});

	it('vale também no posterize', async () => {
		const svg = await vectorizeImage(
			await artTouchingEdges(),
			parseVectorizeParams({
				mode: 'posterize',
				threshold: '128',
				posterizeLevels: '2',
			}),
		);
		expect(inspect(svg).onEdge).toBe(0);
	});

	it('NÃO adiciona margem quando o cliente pediu dimensão exata', async () => {
		// Com dpi/mm definidos, mexer na geometria encolheria a arte dentro do
		// envelope pedido — gravação a laser precisa da medida exata.
		const svg = await vectorizeImage(
			await artTouchingEdges(),
			parseVectorizeParams({
				mode: 'trace',
				threshold: '128',
				outputWidth: '100',
				outputHeight: '100',
			}),
		);
		// Sem margem, a arte volta a tocar a borda — é o trade-off aceito.
		expect(inspect(svg).onEdge).toBeGreaterThan(0);
	});

	it('arte com margem própria não é alterada de forma relevante', async () => {
		const W = 400;
		const H = 400;
		const d = Buffer.alloc(W * H, 255);
		for (let y = 150; y < 250; y++)
			for (let x = 150; x < 250; x++) d[y * W + x] = 0;
		const png = await sharp(d, { raw: { width: W, height: H, channels: 1 } })
			.png()
			.toBuffer();
		const svg = await vectorizeImage(
			png,
			parseVectorizeParams({ mode: 'trace', threshold: '128' }),
		);
		const r = inspect(svg);
		expect(r.subpaths).toBe(1);
		expect(r.onEdge).toBe(0);
	});
});
