import sharp from 'sharp';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

// `generateToolImage` importa o cliente OpenRouter no topo; mockamos o módulo
// pra não tocar rede no caminho legado (não usado aqui, mas evita quebra se
// algum teste futuro cair nele por engano).
const create = vi.fn();
vi.mock('@/lib/openrouter.js', () => ({
	openrouter: { chat: { completions: { create } } },
	PREVIA_MODEL: 'stub',
}));

const { generateToolImage, nearestAspectRatioPreset } = await import(
	'@/lib/image-gen.js'
);

beforeAll(() => {
	process.env.OPENROUTER_API_KEY = 'test-key';
});

/** Presets reais do `google/gemini-3-pro-image-preview` (modelo padrão),
 * espelhados de `image-models-catalog.ts` — testado isolado, sem rede. */
const GEMINI_PRESETS = [
	'1:1',
	'2:3',
	'3:2',
	'3:4',
	'4:3',
	'4:5',
	'5:4',
	'9:16',
	'16:9',
	'21:9',
];

describe('nearestAspectRatioPreset', () => {
	it('2000×1000 (2:1) → 16:9 (mais próximo em escala log)', () => {
		expect(nearestAspectRatioPreset(2000, 1000, GEMINI_PRESETS)).toBe('16:9');
	});

	it('1500×1000 (3:2) → 3:2 (match exato)', () => {
		expect(nearestAspectRatioPreset(1500, 1000, GEMINI_PRESETS)).toBe('3:2');
	});

	it('1000×1000 (1:1) → 1:1', () => {
		expect(nearestAspectRatioPreset(1000, 1000, GEMINI_PRESETS)).toBe('1:1');
	});

	it('devolve undefined se a lista de presets estiver vazia', () => {
		expect(nearestAspectRatioPreset(2000, 1000, [])).toBeUndefined();
	});
});

describe('generateToolImage — dimensão final exata via /v1/images (raw_prompt)', () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		warnSpy.mockRestore();
	});

	/** Monta uma resposta `/v1/images` cujo PNG tem exatamente `width`×`height`. */
	async function mockModelOutput(width: number, height: number) {
		const png = await sharp({
			create: {
				width,
				height,
				channels: 3,
				background: { r: 10, g: 10, b: 10 },
			},
		})
			.png()
			.toBuffer();
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				data: [{ b64_json: png.toString('base64'), media_type: 'image/png' }],
			}),
		});
	}

	it('saída nativa PRÓXIMA do alvo (2:1) — crop mínimo, sem warning de desvio', async () => {
		// 1344×672 é 2:1 exato — mesma proporção do alvo 2000×1000.
		await mockModelOutput(1344, 672);
		const result = await generateToolImage('copo azul', [], undefined, {
			width: 2000,
			height: 1000,
			rawPrompt: true,
			fit: 'cover',
		});
		const meta = await sharp(result.png).metadata();
		expect(meta.width).toBe(2000);
		expect(meta.height).toBe(1000);
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('saída nativa LONGE do alvo (quadrada p/ alvo 2:1) — ainda bate o pixel exato, warning dispara', async () => {
		// 1024×1024 (quadrado) pedido pra um alvo 2000×1000 (2:1) — exatamente o
		// cenário do bug reportado: modelo ignora a proporção, cover crop tem que
		// cortar metade da imagem pra encaixar.
		await mockModelOutput(1024, 1024);
		const result = await generateToolImage('copo azul', [], undefined, {
			width: 2000,
			height: 1000,
			rawPrompt: true,
			fit: 'cover',
		});
		const meta = await sharp(result.png).metadata();
		expect(meta.width).toBe(2000);
		expect(meta.height).toBe(1000);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0][0]).toContain('saída nativa muito diferente');
	});

	it('fit:"fill" (legado, sem raw_prompt) também bate o pixel exato', async () => {
		await mockModelOutput(1024, 1024);
		const result = await generateToolImage('copo azul', [], undefined, {
			width: 1500,
			height: 1000,
			rawPrompt: true,
			fit: 'fill',
		});
		const meta = await sharp(result.png).metadata();
		expect(meta.width).toBe(1500);
		expect(meta.height).toBe(1000);
	});
});
