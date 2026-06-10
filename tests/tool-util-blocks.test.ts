import { describe, expect, it, vi } from 'vitest';
import {
	conditionBlock,
	isBlockedIp,
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

describe('isBlockedIp — anti-SSRF (v4 + v6 mapeado/comprimido)', () => {
	it('bloqueia privados/reservados v4', () => {
		for (const ip of [
			'127.0.0.1',
			'10.0.0.5',
			'192.168.1.1',
			'169.254.169.254',
			'172.16.5.5',
			'100.64.0.1',
			'0.0.0.0',
		])
			expect(isBlockedIp(ip)).toBe(true);
	});
	it('bloqueia v6 loopback/ULA/link-local/multicast', () => {
		for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12::3', 'ff02::1'])
			expect(isBlockedIp(ip)).toBe(true);
	});
	it('bloqueia v6 IPv4-mapeado (hex E dotted) — o bypass de antes', () => {
		for (const ip of [
			'::ffff:127.0.0.1',
			'::ffff:7f00:1', // = 127.0.0.1 em hex
			'::ffff:a9fe:a9fe', // = 169.254.169.254 (metadata)
			'0:0:0:0:0:ffff:7f00:1',
			'::ffff:10.0.0.5',
		])
			expect(isBlockedIp(ip)).toBe(true);
	});
	it('libera IPs públicos', () => {
		for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
			expect(isBlockedIp(ip)).toBe(false);
	});
});

describe('util.http_request — gate', () => {
	it('desabilitado sem a flag', async () => {
		process.env.TOOL_HTTP_ENABLED = '';
		process.env.TOOL_HTTP_ALLOW_HOSTS = '';
		vi.resetModules();
		const { httpRequestBlock } = await import('@/tool-blocks/blocks/util.js');
		await expect(
			httpRequestBlock.run(
				ctx,
				httpRequestBlock.paramsSchema.parse({ url: 'http://1.2.3.4/' }),
			),
		).rejects.toThrow(/desabilitado/i);
	});

	it('fail closed: ligado sem allowlist é recusado', async () => {
		process.env.TOOL_HTTP_ENABLED = 'true';
		process.env.TOOL_HTTP_ALLOW_HOSTS = '';
		vi.resetModules();
		const { httpRequestBlock } = await import('@/tool-blocks/blocks/util.js');
		await expect(
			httpRequestBlock.run(
				ctx,
				httpRequestBlock.paramsSchema.parse({
					url: 'https://api.exemplo.com/',
				}),
			),
		).rejects.toThrow(/allowlist/i);
	});

	it('com allowlist: barra IP interno, literal v6 e protocolo inválido', async () => {
		process.env.TOOL_HTTP_ENABLED = 'true';
		process.env.TOOL_HTTP_ALLOW_HOSTS =
			'127.0.0.1,169.254.169.254,::1,::ffff:7f00:1,example.com';
		vi.resetModules();
		const { httpRequestBlock } = await import('@/tool-blocks/blocks/util.js');
		const call = (url: string) =>
			httpRequestBlock.run(ctx, httpRequestBlock.paramsSchema.parse({ url }));

		await expect(call('http://127.0.0.1/x')).rejects.toThrow(/interna|bloque/i);
		await expect(call('http://169.254.169.254/latest')).rejects.toThrow(
			/interna|bloque/i,
		);
		await expect(call('http://[::1]/')).rejects.toThrow(/interna|bloque/i);
		await expect(call('http://[::ffff:127.0.0.1]/')).rejects.toThrow(
			/interna|bloque/i,
		);
		await expect(call('ftp://example.com/')).rejects.toThrow(/http/i);
		await expect(call('not-a-url')).rejects.toThrow(/inválida/i);
	});
});
