import { describe, expect, it, vi } from 'vitest';
import {
	conditionBlock,
	mathBlock,
	textTemplateBlock,
} from '@/tool-blocks/blocks/util.js';
import type { BlockRunContext } from '@/tool-blocks/types.js';

const ctx: BlockRunContext = { customerId: 'test' };

const run = (
	block: { paramsSchema: { parse: (v: unknown) => unknown }; run: Function },
	raw: unknown,
) => block.run(ctx, block.paramsSchema.parse(raw));

describe('util.text_template', () => {
	it('interpola {{a}}..{{d}}', async () => {
		const out = await run(textTemplateBlock, {
			template: 'Olá {{a}}, você tem {{ b }} itens.',
			a: 'João',
			b: 3,
		});
		expect(out).toEqual({ text: 'Olá João, você tem 3 itens.' });
	});

	it('serializa objeto e trata ausências', async () => {
		const out = await run(textTemplateBlock, {
			template: '[{{a}}][{{c}}]',
			a: { x: 1 },
		});
		expect(out.text).toBe('[{"x":1}][]');
	});
});

describe('util.math', () => {
	it('soma e coage strings', async () => {
		expect(await run(mathBlock, { a: '2', b: 3, op: '+' })).toEqual({
			value: 5,
		});
	});
	it('divide', async () => {
		expect(await run(mathBlock, { a: 10, b: 4, op: '/' })).toEqual({
			value: 2.5,
		});
	});
	it('barra divisão por zero', async () => {
		await expect(run(mathBlock, { a: 1, b: 0, op: '/' })).rejects.toThrow(
			/zero/i,
		);
	});
});

describe('util.condition', () => {
	it('escolhe pelo booleano', async () => {
		expect(
			await run(conditionBlock, { test: true, ifTrue: 'A', ifFalse: 'B' }),
		).toEqual({ result: 'A' });
		expect(
			await run(conditionBlock, { test: 'false', ifTrue: 'A', ifFalse: 'B' }),
		).toEqual({ result: 'B' });
	});
});

describe('util.http_request — anti-SSRF', () => {
	it('bloqueia loopback / link-local / privado e protocolo inválido', async () => {
		process.env.TOOL_HTTP_ENABLED = 'true';
		vi.resetModules();
		const { httpRequestBlock } = await import('@/tool-blocks/blocks/util.js');
		const call = (url: string) =>
			httpRequestBlock.run(ctx, httpRequestBlock.paramsSchema.parse({ url }));

		await expect(call('http://127.0.0.1/x')).rejects.toThrow(/interna|bloque/i);
		await expect(call('http://169.254.169.254/latest')).rejects.toThrow(
			/interna|bloque/i,
		);
		await expect(call('http://10.0.0.5/')).rejects.toThrow(/interna|bloque/i);
		await expect(call('http://192.168.1.1/')).rejects.toThrow(
			/interna|bloque/i,
		);
		await expect(call('ftp://example.com/')).rejects.toThrow(/http/i);
		await expect(call('not-a-url')).rejects.toThrow(/inválida/i);
	});

	it('fica desabilitado sem a flag', async () => {
		process.env.TOOL_HTTP_ENABLED = '';
		vi.resetModules();
		const { httpRequestBlock } = await import('@/tool-blocks/blocks/util.js');
		await expect(
			httpRequestBlock.run(
				ctx,
				httpRequestBlock.paramsSchema.parse({ url: 'http://1.2.3.4/' }),
			),
		).rejects.toThrow(/desabilitado/i);
	});
});
