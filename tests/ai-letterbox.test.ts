import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { verifyStructure } from '@/lib/ai-verify.js';

/**
 * O letterbox vive dentro do `generateVerified` (que chama a IA), então aqui
 * testamos a PROPRIEDADE de que ele depende: completar com margem branca até a
 * proporção da entrada resolve `aspect_changed` sem criar defeito novo.
 *
 * Caso real medido: entrada 1:1 devolvida como 1.8333:1 em três gerações
 * seguidas — sempre o mesmo valor. Retry não corrigia; só desperdiçava geração.
 */
async function img(
	w: number,
	h: number,
	fn: (x: number, y: number) => number,
): Promise<Buffer> {
	const data = Buffer.alloc(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y);
	}
	return sharp(data, { raw: { width: w, height: h, channels: 1 } })
		.png()
		.toBuffer();
}

/** Mesma operação do letterbox de produção: só acrescenta margem branca. */
async function letterbox(png: Buffer, target: number): Promise<Buffer> {
	const m = await sharp(png).metadata();
	const w = m.width ?? 0;
	const h = m.height ?? 0;
	const bg = { r: 255, g: 255, b: 255, alpha: 1 };
	if (w / h > target) {
		const pad = Math.round(w / target) - h;
		return sharp(png)
			.extend({
				top: Math.floor(pad / 2),
				bottom: Math.ceil(pad / 2),
				background: bg,
			})
			.png()
			.toBuffer();
	}
	const pad = Math.round(h * target) - w;
	return sharp(png)
		.extend({
			left: Math.floor(pad / 2),
			right: Math.ceil(pad / 2),
			background: bg,
		})
		.png()
		.toBuffer();
}

const blob = (x: number, y: number) =>
	x > 20 && x < 90 && y > 15 && y < 60 ? 0 : 255;

describe('letterbox p/ corrigir proporção', () => {
	it('saída widescreen contra entrada quadrada dispara aspect_changed', async () => {
		const entrada = await img(128, 128, blob);
		const saida = await img(220, 120, blob);
		const v = await verifyStructure(entrada, saida);
		expect(v.reasons).toContain('aspect_changed');
	});

	it('após o letterbox a proporção bate com a entrada', async () => {
		const entrada = await img(128, 128, blob);
		const saida = await img(220, 120, blob);
		const corrigida = await letterbox(saida, 1);
		const m = await sharp(corrigida).metadata();
		expect((m.width ?? 0) / (m.height ?? 1)).toBeCloseTo(1, 2);
	});

	it('só ACRESCENTA moldura: não corta nem distorce a arte', async () => {
		const saida = await img(220, 120, blob);
		const corrigida = await letterbox(saida, 1);
		const antes = await sharp(saida).metadata();
		const depois = await sharp(corrigida).metadata();
		// Nenhuma dimensão encolhe — logo nada foi cortado nem espremido.
		expect(depois.width ?? 0).toBeGreaterThanOrEqual(antes.width ?? 0);
		expect(depois.height ?? 0).toBeGreaterThanOrEqual(antes.height ?? 0);

		// E a quantidade de tinta é preservada (margem branca não some com traço).
		const tinta = async (b: Buffer) => {
			const { data, info } = await sharp(b)
				.grayscale()
				.raw()
				.toBuffer({ resolveWithObject: true });
			let n = 0;
			for (let i = 0; i < info.width * info.height; i++) {
				if (data[i * info.channels] < 128) n++;
			}
			return n;
		};
		expect(await tinta(corrigida)).toBe(await tinta(saida));
	});

	it('alvo retrato a partir de saída paisagem: cresce em ALTURA', async () => {
		// 200×100 (2.0) para alvo 1:2 (0.5): a moldura tem que entrar em cima e
		// embaixo. Crescer na largura só afastaria ainda mais da proporção.
		const saida = await img(200, 100, blob);
		const corrigida = await letterbox(saida, 0.5);
		const m = await sharp(corrigida).metadata();
		expect((m.width ?? 0) / (m.height ?? 1)).toBeCloseTo(0.5, 1);
		expect(m.width).toBe(200); // largura intacta
		expect(m.height).toBe(400);
	});
});
