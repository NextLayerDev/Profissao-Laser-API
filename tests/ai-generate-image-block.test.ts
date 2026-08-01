import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

	describe('raw_prompt (sem intermediação)', () => {
		it('não envia mensagem de system e manda o prompt cru (sem W×H, sem refs)', async () => {
			create.mockResolvedValue(imageReply());
			await run({ prompt: 'copo azul', raw_prompt: true });
			const [body] = create.mock.calls[0] as [
				{ messages: { role: string }[]; model: string },
			];
			expect(body.messages.map((m) => m.role)).toEqual(['user']);
			// O texto do user é o último segmento do content multimodal.
			const userMsg = body.messages[0] as unknown as {
				content: { type: string; text?: string }[];
			};
			const textSeg = userMsg.content[userMsg.content.length - 1];
			expect(textSeg.text).toBe('copo azul');
		});

		it('não adiciona TEXT_LEAD quando há refs (prompt definido vai cru)', async () => {
			create.mockResolvedValue(imageReply());
			const ref = Buffer.from('png-bytes');
			await run({ prompt: 'copo azul', raw_prompt: true, image: ref });
			const [body] = create.mock.calls[0] as [
				{
					messages: {
						role: string;
						content: { type: string; text?: string }[];
					}[];
				},
			];
			expect(body.messages.map((m) => m.role)).toEqual(['user']);
			const userMsg = body.messages[0];
			const textSeg = userMsg.content[userMsg.content.length - 1];
			// Sem o prefixo "Siga EXATAMENTE estas instruções..." do TEXT_LEAD.
			expect(textSeg.text).toBe('copo azul');
			expect(textSeg.text).not.toContain('autoritativo');
		});

		it('passa a dimensão (sufixo FORMATO) no raw_prompt com W×H — sem system, sem LEAD', async () => {
			// A dimensão é spec de formato (não intermediação de estilo): o modelo
			// precisa compor pra proporção certa pra o sharp NÃO cortar conteúdo.
			create.mockResolvedValue(imageReply());
			await run({
				prompt: 'copo azul',
				raw_prompt: true,
				width: 2000,
				height: 1000,
			});
			const [body] = create.mock.calls[0] as [
				{
					messages: {
						role: string;
						content: { type: string; text?: string }[];
					}[];
				},
			];
			expect(body.messages.map((m) => m.role)).toEqual(['user']);
			const userMsg = body.messages[0];
			const textSeg = userMsg.content[userMsg.content.length - 1];
			expect(textSeg.text).toContain('copo azul');
			expect(textSeg.text).toContain('FORMATO OBRIGATÓRIO');
			expect(textSeg.text).toContain('2:1');
			expect(textSeg.text).not.toContain('autoritativo');
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
