import { describe, expect, it } from 'vitest';
import {
	resolveCreation,
	resolveVariationCount,
} from '@/lib/tool-creations.js';
import type { Creation, ToolDefinitionDoc } from '@/lib/tool-definitions.js';
import { ToolEngineError } from '@/lib/tool-errors.js';

const mkCreations = (): Creation[] => [
	{ id: 'copos-360', label: 'Copos 360º', width: 2000, height: 1000 },
	{ id: 'copos-180', label: 'Copos 180º', width: 1500, height: 1000 },
	{
		id: 'capinhas',
		label: 'Capinhas',
		width: 1000,
		height: 1000,
		active: false,
	},
];

describe('resolveCreation', () => {
	it('devolve W×H da creation escolhida', () => {
		const doc = { creations: mkCreations() } as Pick<
			ToolDefinitionDoc,
			'creations'
		>;
		expect(resolveCreation(doc, 'copos-360')).toEqual({
			width: 2000,
			height: 1000,
		});
		expect(resolveCreation(doc, 'copos-180')).toEqual({
			width: 1500,
			height: 1000,
		});
	});

	it('rejeita (400) quando a tool tem creations mas o cliente não escolheu nenhuma', () => {
		const doc = { creations: mkCreations() } as Pick<
			ToolDefinitionDoc,
			'creations'
		>;
		expect(() => resolveCreation(doc, undefined)).toThrow(ToolEngineError);
		try {
			resolveCreation(doc, undefined);
		} catch (e) {
			expect((e as ToolEngineError).status).toBe(400);
			expect((e as ToolEngineError).message).toContain('tipo de criação');
		}
	});

	it('rejeita (400) creation_id inexistente', () => {
		const doc = { creations: mkCreations() } as Pick<
			ToolDefinitionDoc,
			'creations'
		>;
		expect(() => resolveCreation(doc, 'inexistente')).toThrow(ToolEngineError);
	});

	it('rejeita (400) creation_id inativo (active:false)', () => {
		const doc = { creations: mkCreations() } as Pick<
			ToolDefinitionDoc,
			'creations'
		>;
		expect(() => resolveCreation(doc, 'capinhas')).toThrow(ToolEngineError);
	});

	it('legado: tool sem creations devolve undefined (cai em image_width/height)', () => {
		const doc = { creations: undefined } as Pick<
			ToolDefinitionDoc,
			'creations'
		>;
		// Não lança mesmo sem creation_id.
		expect(resolveCreation(doc, undefined)).toEqual({
			width: undefined,
			height: undefined,
		});
		expect(resolveCreation(doc, 'whatever')).toEqual({
			width: undefined,
			height: undefined,
		});
	});
});

describe('resolveVariationCount', () => {
	it('default = 1º elemento do allowlist quando não vem campo', () => {
		expect(resolveVariationCount(undefined, [1, 2, 4])).toBe(1);
		expect(resolveVariationCount(undefined, [2, 4])).toBe(2);
		expect(resolveVariationCount(undefined, [])).toBe(1); // allowlist vazia → 1
	});

	it('aceita valor dentro do allowlist', () => {
		expect(resolveVariationCount('1', [1, 2, 4])).toBe(1);
		expect(resolveVariationCount('2', [1, 2, 4])).toBe(2);
		expect(resolveVariationCount('4', [1, 2, 4])).toBe(4);
	});

	it('rejeita (400) valor fora do allowlist', () => {
		expect(() => resolveVariationCount('3', [1, 2, 4])).toThrow(
			ToolEngineError,
		);
		expect(() => resolveVariationCount('5', [1, 2, 4])).toThrow(
			ToolEngineError,
		);
		expect(() => resolveVariationCount('abc', [1, 2, 4])).toThrow(
			ToolEngineError,
		);
	});

	it('rejeita (400) quando allowlist não inclui 1 e o cliente manda 1', () => {
		// Admin pode querer só [2,4] (sem 1x) — 1x deve ser rejeitado.
		expect(() => resolveVariationCount('1', [2, 4])).toThrow(ToolEngineError);
	});
});
