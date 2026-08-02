import { beforeEach, describe, expect, it, vi } from 'vitest';

// O bloco importa o cliente OpenRouter no topo; mockamos o módulo inteiro para
// não tocar a rede nem exigir OPENROUTER_API_KEY no CI.
const create = vi.fn();
vi.mock('@/lib/openrouter.js', () => ({
	openrouter: { chat: { completions: { create } } },
	PREVIA_MODEL: 'stub',
}));

const { aiTextBlock } = await import('@/tool-blocks/blocks/ai-text.js');
const { blockRegistry } = await import('@/tool-blocks/registry.js');
const { registerCoreBlocks } = await import('@/tool-blocks/index.js');
const { ToolEngineError } = await import('@/lib/tool-errors.js');
const { getDefaultTextModelId } = await import('@/lib/text-models-catalog.js');

const ctx = { customerId: 'cust-1' };

/** Resposta mínima no formato do SDK da OpenAI. */
const reply = (content: string) => ({ choices: [{ message: { content } }] });

const run = (raw: unknown) =>
	aiTextBlock.run(ctx, aiTextBlock.paramsSchema.parse(raw) as never);

beforeEach(() => {
	create.mockReset();
});

describe('ai.text', () => {
	it('está registrado no registry pelo registerCoreBlocks', () => {
		registerCoreBlocks();
		expect(blockRegistry.has('ai.text')).toBe(true);
		expect(blockRegistry.get('ai.text')?.category).toBe('ai');
	});

	it('devolve o texto do modelo e o id do modelo usado', async () => {
		create.mockResolvedValue(reply('Peça em aço 2mm, corte simples.'));
		const out = await run({ user: 'descreva a peça' });
		expect(out).toEqual({
			text: 'Peça em aço 2mm, corte simples.',
			json: null,
			model: getDefaultTextModelId(),
		});
	});

	it('omite a mensagem de system quando ela está vazia', async () => {
		create.mockResolvedValue(reply('ok'));
		await run({ user: 'oi', system: '   ' });
		const [body] = create.mock.calls[0] as [{ messages: { role: string }[] }];
		expect(body.messages.map((m) => m.role)).toEqual(['user']);
	});

	it('usa o modelo pedido quando ele está no catálogo', async () => {
		create.mockResolvedValue(reply('ok'));
		const out = await run({ user: 'oi', model: 'anthropic/claude-haiku-4.5' });
		expect(out.model).toBe('anthropic/claude-haiku-4.5');
	});

	it('cai no padrão (sem lançar) quando o modelo é desconhecido', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		create.mockResolvedValue(reply('ok'));
		const out = await run({ user: 'oi', model: 'vendor/inexistente' });
		expect(out.model).toBe(getDefaultTextModelId());
		warn.mockRestore();
	});

	describe('modo json', () => {
		it('pede response_format e faz parse do objeto', async () => {
			create.mockResolvedValue(reply('{"preco": 120, "peca": "flange"}'));
			const out = await run({ user: 'orce', json: true });
			expect(out.json).toEqual({ preco: 120, peca: 'flange' });
			const [body] = create.mock.calls[0] as [{ response_format?: unknown }];
			expect(body.response_format).toEqual({ type: 'json_object' });
		});

		it('extrai JSON mesmo embrulhado em cerca de markdown', async () => {
			create.mockResolvedValue(
				reply('Segue:\n```json\n{"ok": true}\n```\nabraço'),
			);
			const out = await run({ user: 'x', json: true });
			expect(out.json).toEqual({ ok: true });
		});

		it('extrai JSON quando o modelo tagarela antes e depois', async () => {
			create.mockResolvedValue(reply('Claro! {"a":1} — espero ter ajudado.'));
			const out = await run({ user: 'x', json: true });
			expect(out.json).toEqual({ a: 1 });
		});

		it('lança 502 quando não há JSON algum na resposta', async () => {
			create.mockResolvedValue(reply('não consegui responder'));
			await expect(run({ user: 'x', json: true })).rejects.toMatchObject({
				status: 502,
			});
		});

		it('retenta sem response_format quando o provedor devolve 4xx', async () => {
			// É o caso real que o upvox já provou: nem todo provedor por trás do
			// OpenRouter aceita structured output.
			create
				.mockRejectedValueOnce(Object.assign(new Error('bad'), { status: 400 }))
				.mockResolvedValueOnce(reply('{"b":2}'));
			const out = await run({ user: 'x', json: true });
			expect(out.json).toEqual({ b: 2 });
			expect(create).toHaveBeenCalledTimes(2);
			const [second] = create.mock.calls[1] as [{ response_format?: unknown }];
			expect(second.response_format).toBeUndefined();
		});
	});

	describe('erros', () => {
		it('trata 200 com {error} do OpenRouter como 502', async () => {
			// O SDK não considera isso erro — a guarda é nossa.
			create.mockResolvedValue({ error: { message: 'sem créditos' } });
			await expect(run({ user: 'x' })).rejects.toMatchObject({ status: 502 });
		});

		it('mapeia 429 para 429', async () => {
			create.mockRejectedValue(
				Object.assign(new Error('rate'), { status: 429 }),
			);
			await expect(run({ user: 'x' })).rejects.toMatchObject({ status: 429 });
		});

		it('mapeia timeout para 504', async () => {
			create.mockRejectedValue(
				Object.assign(new Error('t'), { name: 'TimeoutError' }),
			);
			await expect(run({ user: 'x' })).rejects.toMatchObject({ status: 504 });
		});

		it('lança ToolEngineError (para o motor saber estornar)', async () => {
			create.mockRejectedValue(new Error('boom'));
			await expect(run({ user: 'x' })).rejects.toBeInstanceOf(ToolEngineError);
		});
	});

	it('rejeita prompt vazio no schema', () => {
		expect(() => aiTextBlock.paramsSchema.parse({ user: '' })).toThrow();
	});
});
