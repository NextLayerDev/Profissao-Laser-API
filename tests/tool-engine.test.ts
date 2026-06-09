import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	coerceInputs,
	executeTool,
	projectOutput,
	resolveRefs,
	ToolEngineError,
} from '@/lib/tool-engine.js';
import { blockRegistry } from '@/tool-blocks/registry.js';

// Bloco fake só pra testar a orquestração do motor (sem tocar sharp/storage).
const echoSchema = z.object({
	value: z.unknown(),
	flag: z.boolean().optional(),
});
blockRegistry.register({
	id: 'test.echo',
	category: 'test',
	description: 'echo dos params',
	paramsSchema: echoSchema,
	async run(_ctx, params: z.infer<typeof echoSchema>) {
		return { value: params.value, flag: params.flag };
	},
});

const ctx = { customerId: 'c1' };

describe('coerceInputs', () => {
	it('coage tipos e aplica defaults', () => {
		const bag = coerceInputs(
			{
				n: { type: 'number', min: 1, max: 10 },
				i: { type: 'int', default: 254 },
				b: { type: 'bool', default: true },
				m: { type: 'enum', options: ['a', 'b'], default: 'a' },
				img: { type: 'image', required: false },
			},
			{ n: '5', m: 'b' },
			null,
		);
		expect(bag['input.n']).toBe(5);
		expect(bag['input.i']).toBe(254);
		expect(bag['input.b']).toBe(true);
		expect(bag['input.m']).toBe('b');
		expect(bag['input.img']).toBeNull();
	});

	it('rejeita fora do limite e enum inválido', () => {
		expect(() =>
			coerceInputs({ n: { type: 'number', max: 3 } }, { n: '9' }, null),
		).toThrow(ToolEngineError);
		expect(() =>
			coerceInputs({ m: { type: 'enum', options: ['a'] } }, { m: 'z' }, null),
		).toThrow(ToolEngineError);
	});

	it('exige imagem obrigatória', () => {
		expect(() =>
			coerceInputs({ img: { type: 'image', required: true } }, {}, null),
		).toThrow(ToolEngineError);
	});
});

describe('resolveRefs', () => {
	it('resolve refs e negação; mantém literais', () => {
		const bag: Record<string, unknown> = Object.create(null);
		bag['input.material'] = 'wood';
		bag['input.dither'] = true;
		bag['prep.png'] = 'PNGBUF';
		const heads = new Set(['input', 'prep']);
		const out = resolveRefs(
			{
				material: 'input.material',
				noDither: '!input.dither',
				from: 'prep.png',
				folder: 'laser-prep',
				n: 5,
			},
			bag,
			heads,
		);
		expect(out).toEqual({
			material: 'wood',
			noDither: false,
			from: 'PNGBUF',
			folder: 'laser-prep',
			n: 5,
		});
	});

	it('trata cabeça desconhecida como literal', () => {
		const out = resolveRefs(
			{ x: 'foo.bar' },
			Object.create(null),
			new Set(['input']),
		);
		expect(out.x).toBe('foo.bar');
	});
});

describe('projectOutput', () => {
	it('resolve primary/preview e agrupa meta (array → objeto)', () => {
		const bag: Record<string, unknown> = Object.create(null);
		bag['store.url'] = 'http://x/y.png';
		bag['prep.pngBase64'] = 'data:...';
		bag['prep.width_mm'] = 150;
		bag['prep.dpi'] = 254;
		const heads = new Set(['input', 'prep', 'store']);
		const out = projectOutput(
			{
				primary: 'store.url',
				preview: 'prep.pngBase64',
				meta: ['prep.width_mm', 'prep.dpi'],
				savable: true,
			},
			bag,
			heads,
		);
		expect(out).toEqual({
			primary: 'http://x/y.png',
			preview: 'data:...',
			meta: { width_mm: 150, dpi: 254 },
			savable: true,
		});
	});
});

describe('executeTool', () => {
	it('roda o pipeline linear e projeta a saída', async () => {
		const bag = coerceInputs(
			{ v: { type: 'number' }, flag: { type: 'bool', default: true } },
			{ v: '7' },
			null,
		);
		const out = await executeTool(
			{
				pipeline: [
					{
						id: 'a',
						block: 'test.echo',
						params: { value: 'input.v', flag: '!input.flag' },
					},
				],
				output: { result: 'a.value', neg: 'a.flag' },
			},
			bag,
			ctx,
		);
		expect(out).toEqual({ result: 7, neg: false });
	});

	it('rejeita bloco desconhecido', async () => {
		await expect(
			executeTool(
				{ pipeline: [{ id: 'a', block: 'nope' }], output: {} },
				Object.create(null),
				ctx,
			),
		).rejects.toThrow(ToolEngineError);
	});

	it('rejeita id de nó inválido', async () => {
		await expect(
			executeTool(
				{
					pipeline: [{ id: '1bad', block: 'test.echo', params: {} }],
					output: {},
				},
				Object.create(null),
				ctx,
			),
		).rejects.toThrow(ToolEngineError);
	});

	it('rejeita pipeline vazio', async () => {
		await expect(
			executeTool({ pipeline: [], output: {} }, Object.create(null), ctx),
		).rejects.toThrow(ToolEngineError);
	});
});
