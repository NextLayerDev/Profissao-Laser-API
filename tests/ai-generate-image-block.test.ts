import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

// O bloco importa o cliente OpenRouter no topo; mockamos o módulo inteiro para
// não tocar a rede nem exigir OPENROUTER_API_KEY real no CI.
const create = vi.fn();
vi.mock('@/lib/openrouter.js', () => ({
	openrouter: { chat: { completions: { create } } },
	PREVIA_MODEL: 'stub',
}));

const { aiGenerateImageBlock } = await import('@/tool-blocks/blocks/ai.js');
const { blockRegistry } = await import('@/tool-blocks/registry.js');
const { registerCoreBlocks } = await import('@/tool-blocks/index.js');

const ctx = { customerId: 'cust-1' };

// 2×2 PNG válida (base64) — sharp decodifica/redimensiona sem erro.
const TINY_PNG_B64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVR4nGNgYPj/H4KhDAA/0gf5tBJPzQAAAABJRU5ErkJggg==';

/** Resposta no formato Gemini via OpenRouter (campo `images[0].image_url.url`). */
const imageReply = () => ({
	choices: [
		{
			message: {
				images: [
					{ image_url: { url: `data:image/png;base64,${TINY_PNG_B64}` } },
				],
			},
		},
	],
});

const run = (raw: unknown) =>
	aiGenerateImageBlock.run(
		ctx,
		aiGenerateImageBlock.paramsSchema.parse(raw) as never,
	);

beforeAll(() => {
	// `generateToolImage` recusa sem chave; o mock não lê o env, mas a guarda sim.
	process.env.OPENROUTER_API_KEY = 'test-key';
});

beforeEach(() => {
	create.mockReset();
});

describe('ai.generate_image', () => {
	it('está registrado no registry pelo registerCoreBlocks', () => {
		registerCoreBlocks();
		expect(blockRegistry.has('ai.generate_image')).toBe(true);
		expect(blockRegistry.get('ai.generate_image')?.category).toBe('ai');
	});

	it('gera 1 imagem por default e expõe png/pngBase64 + images[1]', async () => {
		create.mockResolvedValue(imageReply());
		const out = await run({ prompt: 'um copo azul' });
		expect(create).toHaveBeenCalledTimes(1);
		expect(out.images).toHaveLength(1);
		expect(out.pngBase64).toBe(out.images[0].pngBase64);
		expect((out.png as Buffer).equals(out.images[0].png as Buffer)).toBe(true);
	});

	it('gera N variações chamando o modelo N vezes (sequencial)', async () => {
		create.mockResolvedValue(imageReply());
		const out = await run({ prompt: 'copo', variation_count: 3 });
		expect(create).toHaveBeenCalledTimes(3);
		expect(out.images).toHaveLength(3);
		// png/pngBase64 continuam apontando pra 1ª imagem (back-compat).
		expect(out.pngBase64).toBe(out.images[0].pngBase64);
	});

	it('rejeita variation_count fora de [1,4] no schema', () => {
		expect(() =>
			aiGenerateImageBlock.paramsSchema.parse({
				prompt: 'copo',
				variation_count: 9,
			}),
		).toThrow();
	});

	describe('raw_prompt (sem intermediação) — modelo com unifiedImagesApi (default)', () => {
		// O modelo padrão (`google/gemini-3-pro-image-preview`) tem
		// `unifiedImagesApi:true` no catálogo, então `raw_prompt` roteia pro
		// `POST /v1/images` via `fetch` global (não mais `create`/chat.completions).
		let fetchMock: ReturnType<typeof vi.fn>;

		const unifiedImagesReply = () => ({
			ok: true,
			status: 200,
			json: async () => ({
				data: [{ b64_json: TINY_PNG_B64, media_type: 'image/png' }],
			}),
		});

		beforeEach(() => {
			fetchMock = vi.fn().mockResolvedValue(unifiedImagesReply());
			vi.stubGlobal('fetch', fetchMock);
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it('chama POST /v1/images (não chat.completions) sem W×H, sem refs', async () => {
			await run({ prompt: 'copo azul', raw_prompt: true });
			expect(create).not.toHaveBeenCalled();
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe('https://openrouter.ai/api/v1/images');
			const body = JSON.parse(init.body as string);
			expect(body.model).toBe('google/gemini-3-pro-image-preview');
			expect(body.prompt).toBe('copo azul');
			expect(body.input_references).toBeUndefined();
			expect(body.aspect_ratio).toBeUndefined();
		});

		it('não adiciona TEXT_LEAD quando há refs (prompt definido vai cru) — refs viram input_references', async () => {
			const ref = Buffer.from('png-bytes');
			await run({ prompt: 'copo azul', raw_prompt: true, image: ref });
			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			const body = JSON.parse(init.body as string);
			// Sem o prefixo "Siga EXATAMENTE estas instruções..." do TEXT_LEAD.
			expect(body.prompt).toBe('copo azul');
			expect(body.prompt).not.toContain('autoritativo');
			expect(body.input_references).toHaveLength(1);
			expect(body.input_references[0]).toEqual({
				type: 'image_url',
				image_url: { url: `data:image/png;base64,${ref.toString('base64')}` },
			});
		});

		it('passa aspect_ratio/resolution REAIS + sufixo FORMATO no raw_prompt com W×H', async () => {
			// A dimensão vira parâmetro real (não só texto): o modelo compõe na
			// proporção certa pra o sharp NÃO precisar cortar conteúdo depois.
			await run({
				prompt: 'copo azul',
				raw_prompt: true,
				width: 2000,
				height: 1000,
			});
			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			const body = JSON.parse(init.body as string);
			expect(body.prompt).toContain('copo azul');
			expect(body.prompt).toContain('FORMATO OBRIGATÓRIO');
			expect(body.prompt).toContain('2:1');
			expect(body.prompt).not.toContain('autoritativo');
			expect(body.aspect_ratio).toBe('16:9');
			expect(body.resolution).toBe('4K');
		});
	});

	describe('raw_prompt com modelo SEM unifiedImagesApi (fallback pro legado)', () => {
		it('cai em /chat/completions quando o model override não está no catálogo', async () => {
			create.mockResolvedValue(imageReply());
			const fetchMock = vi.fn();
			vi.stubGlobal('fetch', fetchMock);
			await run({
				prompt: 'copo azul',
				raw_prompt: true,
				model: 'algum/modelo-desconhecido',
			});
			expect(create).toHaveBeenCalledTimes(1);
			expect(fetchMock).not.toHaveBeenCalled();
			const [body] = create.mock.calls[0] as [
				{ messages: { role: string }[]; model: string },
			];
			expect(body.model).toBe('algum/modelo-desconhecido');
			expect(body.messages.map((m) => m.role)).toEqual(['user']);
			vi.unstubAllGlobals();
		});
	});

	describe('legado (sem raw_prompt)', () => {
		it('envia system message e injeta sufixo FORMATO quando W×H setados', async () => {
			create.mockResolvedValue(imageReply());
			await run({ prompt: 'copo azul', width: 2000, height: 1000 });
			const [body] = create.mock.calls[0] as [
				{
					messages: {
						role: string;
						content: { type: string; text?: string }[];
					}[];
				},
			];
			expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
			const userMsg = body.messages[1];
			const textSeg = userMsg.content[userMsg.content.length - 1];
			expect(textSeg.text).toContain('FORMATO OBRIGATÓRIO');
		});

		it('adiciona TEXT_LEAD quando há refs', async () => {
			create.mockResolvedValue(imageReply());
			const ref = Buffer.from('png-bytes');
			await run({ prompt: 'copo azul', image: ref });
			const [body] = create.mock.calls[0] as [
				{
					messages: {
						role: string;
						content: { type: string; text?: string }[];
					}[];
				},
			];
			const userMsg = body.messages[1];
			const textSeg = userMsg.content[userMsg.content.length - 1];
			expect(textSeg.text).toContain('autoritativo');
		});
	});

	it('rejeita prompt vazio no schema', () => {
		expect(() =>
			aiGenerateImageBlock.paramsSchema.parse({ prompt: '' }),
		).toThrow();
	});
});
