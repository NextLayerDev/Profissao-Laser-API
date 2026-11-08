import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

/**
 * Vetorização AUTOMÁTICA (porte da Comunidade Laser, sem níveis de modelo).
 * Só caminhos sem rede: o traço local do logo, o motor laser/negativo e o
 * acabamento para o EzCad. A IA é mockada para provar que o logo limpo NÃO a
 * chama e que, quando chama, é sempre o modelo mais forte.
 */

vi.hoisted(() => {
	process.env.OPENROUTER_API_KEY ||= 'test-key';
});

vi.mock('../src/lib/image-gen.js', async (importOriginal) => {
	const real = await importOriginal<typeof import('../src/lib/image-gen.js')>();
	return { ...real, generateToolImage: vi.fn() };
});

import { generateToolImage } from '../src/lib/image-gen.js';
import { runLaserEngine } from '../src/lib/vectorize-auto/engine/engine.js';
import {
	VECTORIZE_AI_MODEL,
	vectorizeAuto,
} from '../src/lib/vectorize-auto/pipeline.js';
import { finalizeSvg } from '../src/lib/vectorize-auto/svg-finalize.js';

vi.setConfig({ testTimeout: 60_000 });

function noisyImage(): Promise<Buffer> {
	return sharp({
		create: {
			width: 300,
			height: 300,
			channels: 3,
			background: { r: 128, g: 128, b: 128 },
			noise: { type: 'gaussian', mean: 128, sigma: 60 },
		},
	})
		.png()
		.toBuffer();
}

const mockGen = vi.mocked(generateToolImage);

async function cleanLogo(): Promise<Buffer> {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600">
<rect width="900" height="600" fill="#fff"/>
<circle cx="450" cy="230" r="170" fill="none" stroke="#000" stroke-width="30"/>
<path d="M370 300 L450 140 L530 300 Z M410 275 L490 275 L450 195 Z" fill="#000" fill-rule="evenodd"/>
<rect x="250" y="470" width="400" height="60" fill="#000"/>
</svg>`;
	return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Todo subpath de todo path termina em Z (o EzCad precisa do fechamento). */
function allSubpathsClosed(svg: string): boolean {
	const ds = [...svg.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
	if (ds.length === 0) return false;
	return ds.every((d) =>
		d
			.split(/(?=M)/)
			.filter((s) => s.trim())
			.every((s) => /Z\s*$/i.test(s.trim())),
	);
}

describe('vectorizeAuto — logo limpo', () => {
	it('traça localmente, sem chamar a IA', async () => {
		mockGen.mockClear();
		const r = await vectorizeAuto({ buffer: await cleanLogo() });
		expect(r.kind).toBe('logo');
		expect(r.route).toBe('logo-local');
		expect(r.engine).toBe('local');
		expect(r.aiAttempts).toBe(0);
		expect(mockGen).not.toHaveBeenCalled();
	});

	it('sai em mm, com tinta preta e subpaths fechados', async () => {
		const r = await vectorizeAuto({ buffer: await cleanLogo(), widthMm: 80 });
		// 80 mm úteis + 2 mm de margem de cada lado.
		expect(r.svgContent).toMatch(/<svg[^>]*width="84mm"/);
		expect(r.widthMm).toBe(80);
		expect(r.heightMm).toBeCloseTo(80 * (600 / 900), 0);
		expect(r.svgContent).not.toMatch(/fill="#FFFFFF"/i);
		expect(allSubpathsClosed(r.svgContent)).toBe(true);
	});

	it('copo escuro de logo usa o negativo do motor, num path só, sem IA', async () => {
		mockGen.mockClear();
		const r = await vectorizeAuto({
			buffer: await cleanLogo(),
			kind: 'logo',
			darkCup: true,
		});
		expect(r.route).toBe('logo-negative');
		expect(mockGen).not.toHaveBeenCalled();
		expect((r.svgContent.match(/<path/g) ?? []).length).toBe(1);
		expect(r.svgContent).toMatch(/fill-rule="evenodd"/);
	});
});

describe('vectorizeAuto — logo que reprova o traço local', () => {
	it('cai na IA com o modelo mais forte e traça no modo laser', async () => {
		mockGen.mockReset();
		// "IA" devolve uma arte P&B limpa.
		mockGen.mockResolvedValue({
			png: await cleanLogo(),
			pngBase64: '',
		});
		// Textura de ruído: a prontidão reprova e o Automático chama a IA.
		const gradient = await noisyImage();
		const r = await vectorizeAuto({ buffer: gradient, kind: 'logo' });
		expect(r.route).toBe('logo-ai-laser');
		expect(r.aiAttempts).toBe(1);
		expect(mockGen).toHaveBeenCalledTimes(1);
		expect(mockGen.mock.calls[0][3]).toMatchObject({
			model: VECTORIZE_AI_MODEL,
			rawPrompt: true,
		});
		expect(VECTORIZE_AI_MODEL).toBe('google/gemini-3-pro-image-preview');
	});

	it('propaga a falha da IA (o controller estorna)', async () => {
		mockGen.mockReset();
		mockGen.mockRejectedValue(new Error('402 sem saldo'));
		const noisy = await noisyImage();
		await expect(
			vectorizeAuto({ buffer: noisy, kind: 'logo' }),
		).rejects.toThrow('402');
	});
});

describe('motor laser portado', () => {
	it('faz o upscale de qualidade de imagens pequenas', async () => {
		const small = await sharp(await cleanLogo())
			.resize(300)
			.png()
			.toBuffer();
		const out = await runLaserEngine(small, 'laser');
		expect(out.upscaled).not.toBeNull();
		expect(out.upscaled?.to).toBeGreaterThan(300);
		expect(allSubpathsClosed(out.svg)).toBe(true);
	});

	it('finalizeSvg mantém a proporção do viewBox', () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><path fill="#FFFFFF" d="M0 0 L10 0 L10 10"/></svg>';
		const out = finalizeSvg(svg, 100, 0);
		expect(out).toMatch(/width="100mm"/);
		expect(out).toMatch(/height="50mm"/);
		expect(out).toMatch(/fill="#000000"/);
		expect(allSubpathsClosed(out)).toBe(true);
	});
});
