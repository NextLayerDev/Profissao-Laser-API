import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { parseVectorizeParams, vectorizeImage } from '@/lib/vectorize.js';

/** Conta componentes BRANCOS fechados (buracos) num SVG renderizado. */
async function countHoles(svg: string, dim = 600) {
	const { data, info } = await sharp(Buffer.from(svg))
		.resize(dim, dim, { fit: 'fill' })
		.flatten({ background: '#ffffff' })
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const W = info.width;
	const H = info.height;
	const ch = info.channels;
	const N = W * H;
	const white = new Uint8Array(N);
	for (let i = 0; i < N; i++) white[i] = data[i * ch] >= 128 ? 1 : 0;
	const seen = new Uint8Array(N);
	const st = new Int32Array(N);
	const holes: number[] = [];
	for (let s = 0; s < N; s++) {
		if (!white[s] || seen[s]) continue;
		let sp = 0;
		let size = 0;
		let edge = false;
		st[sp++] = s;
		seen[s] = 1;
		while (sp > 0) {
			const i = st[--sp];
			size++;
			const x = i % W;
			const y = (i / W) | 0;
			if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
			for (const j of [
				x > 0 ? i - 1 : -1,
				x < W - 1 ? i + 1 : -1,
				y > 0 ? i - W : -1,
				y < H - 1 ? i + W : -1,
			]) {
				if (j >= 0 && white[j] && !seen[j]) {
					seen[j] = 1;
					st[sp++] = j;
				}
			}
		}
		if (!edge) holes.push(size);
	}
	return holes;
}

/** Bloco preto com um buraco branco de `hole`×`hole` no meio. */
async function blobWithHole(hole: number, size = 600): Promise<Buffer> {
	const d = Buffer.alloc(size * size, 255);
	const a = Math.round(size * 0.2);
	const b = size - a;
	for (let y = a; y < b; y++) for (let x = a; x < b; x++) d[y * size + x] = 0;
	const c = size / 2;
	const h = hole / 2;
	for (let y = c - h; y < c + h; y++) {
		for (let x = c - h; x < c + h; x++) d[y * size + x] = 255;
	}
	return sharp(d, { raw: { width: size, height: size, channels: 1 } })
		.png()
		.toBuffer();
}

const trace = parseVectorizeParams({ mode: 'trace', threshold: '128' });
/** Gravura de foto com IA — único caminho onde buraco fechado é sempre defeito. */
const traceHeal = parseVectorizeParams({
	mode: 'trace',
	threshold: '128',
	healHoles: 'true',
});

describe('buracos brancos fechados dentro da arte', () => {
	it('tapa buraco pequeno quando healHoles está ligado', async () => {
		// 12×12 = 144px num raster de 600² → bem abaixo do teto de 0.1%.
		const svg = await vectorizeImage(await blobWithHole(12), traceHeal);
		expect(await countHoles(svg)).toHaveLength(0);
	});

	it('DESLIGADO por padrão: contraforma de letra sobrevive', async () => {
		// É a proteção do caminho de logo/texto: a contraforma de um "o" pequeno
		// fica bem abaixo do teto e seria tapada, virando bolha sólida.
		const svg = await vectorizeImage(await blobWithHole(12), trace);
		expect((await countHoles(svg)).length).toBeGreaterThan(0);
	});

	it('PRESERVA vazado grande mesmo com healHoles ligado', async () => {
		// 200×200 = 40 000px → muito acima do teto; é intencional.
		const svg = await vectorizeImage(await blobWithHole(200), traceHeal);
		expect((await countHoles(svg)).length).toBeGreaterThan(0);
	});

	it('não altera arte sem buracos', async () => {
		const size = 600;
		const d = Buffer.alloc(size * size, 255);
		for (let y = 120; y < 480; y++)
			for (let x = 120; x < 480; x++) d[y * size + x] = 0;
		const png = await sharp(d, {
			raw: { width: size, height: size, channels: 1 },
		})
			.png()
			.toBuffer();
		const svg = await vectorizeImage(png, trace);
		expect(await countHoles(svg)).toHaveLength(0);
		expect((svg.match(/M/g) ?? []).length).toBe(1);
	});

	it('NÃO funde as frestas entre hachuras (elas não são fechadas)', async () => {
		// Listras: as faixas brancas conectam ao fundo, então nada é preenchido.
		const size = 600;
		const d = Buffer.alloc(size * size, 255);
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				if ((x >> 3) % 2 === 0) d[y * size + x] = 0;
			}
		}
		const png = await sharp(d, {
			raw: { width: size, height: size, channels: 1 },
		})
			.png()
			.toBuffer();
		const svg = await vectorizeImage(png, trace);
		// Continua listrado: muitos subpaths, nada fundido num bloco só.
		expect((svg.match(/M/g) ?? []).length).toBeGreaterThan(20);
	});
});
