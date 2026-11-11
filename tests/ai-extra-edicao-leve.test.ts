import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Sem rede: o cliente do `/chat/completions` vira dublê e o `/v1/images` é o
// `fetch` global stubado abaixo.
const create = vi.fn();
vi.mock('@/lib/openrouter.js', () => ({
	openrouter: { chat: { completions: { create } } },
	PREVIA_MODEL: 'stub',
}));

const { aiExtraBlocks } = await import('@/tool-blocks/blocks/ai-extra.js');

const bloco = (id: string) => {
	const b = aiExtraBlocks.find((x) => x.id === id);
	if (!b) throw new Error(`bloco ${id} não registrado`);
	return b;
};

/** Foto de entrada 2000×1500 (4:3) — maior que a faixa 1K. */
const foto = () =>
	sharp({
		create: { width: 2000, height: 1500, channels: 3, background: '#888' },
	})
		.png()
		.toBuffer();

async function respostaDoModelo(w: number, h: number) {
	const png = await sharp({
		create: { width: w, height: h, channels: 3, background: '#fff' },
	})
		.png()
		.toBuffer();
	return {
		ok: true,
		status: 200,
		json: async () => ({ data: [{ b64_json: png.toString('base64') }] }),
	};
}

beforeAll(() => {
	process.env.OPENROUTER_API_KEY = 'test-key';
});

afterEach(() => {
	vi.unstubAllGlobals();
	create.mockReset();
});

describe('edições simples vão ao modelo leve, a 1K, com tamanho explícito', () => {
	for (const id of ['ai.backgroundRemoval', 'ai.colorize', 'ai.restoration']) {
		it(`${id}: /v1/images com flash-lite, 4:3 e 1K; saída na proporção da foto`, async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(await respostaDoModelo(1184, 864));
			vi.stubGlobal('fetch', fetchMock);

			const out = (await bloco(id).run(
				{ customerId: 'c', toolKey: 'restaurar_foto' },
				bloco(id).paramsSchema.parse({ image: await foto() }),
			)) as { png: Buffer };

			expect(create).not.toHaveBeenCalled();
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe('https://openrouter.ai/api/v1/images');
			const body = JSON.parse(init.body as string);
			expect(body.model).toBe('google/gemini-3.1-flash-lite-image');
			expect(body.resolution).toBe('1K');
			expect(body.aspect_ratio).toBe('4:3');
			expect(body.user).toBeUndefined();
			const headers = init.headers as Record<string, string>;
			expect(headers['X-Title']).toBe('Profissão Laser - restaurar_foto');

			// Lado maior em 1024, na proporção da foto do aluno.
			const meta = await sharp(out.png).metadata();
			expect([meta.width, meta.height]).toEqual([1024, 768]);
		});
	}
});
