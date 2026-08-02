import { describe, expect, it, vi } from 'vitest';
import {
	findTextModel,
	getDefaultTextModel,
	getDefaultTextModelId,
	getTextModelsCatalog,
	resolveTextModel,
	TEXT_MODELS_CATALOG,
} from '../src/lib/text-models-catalog.js';

describe('text-models-catalog', () => {
	it('tem exatamente um modelo marcado como padrão', () => {
		const defaults = TEXT_MODELS_CATALOG.filter((m) => m.default);
		expect(defaults).toHaveLength(1);
		expect(getDefaultTextModelId()).toBe(defaults[0]?.id);
	});

	it('não tem ids duplicados', () => {
		const ids = TEXT_MODELS_CATALOG.map((m) => m.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('todo modelo tem preço positivo (o metering depende disso)', () => {
		for (const m of TEXT_MODELS_CATALOG) {
			expect(m.pricing.in, m.id).toBeGreaterThan(0);
			expect(m.pricing.out, m.id).toBeGreaterThan(0);
		}
	});

	it('todo id segue o formato `vendor/modelo` do OpenRouter', () => {
		// Guarda contra o erro que já aconteceu no catálogo de imagem: id escrito
		// de memória, sem barra, que só quebrava em runtime.
		for (const m of TEXT_MODELS_CATALOG) {
			expect(m.id, m.id).toMatch(/^[a-z0-9-]+\/[a-zA-Z0-9._-]+$/);
		}
	});

	it('o padrão suporta tool-use e json (é o modelo dos agentes)', () => {
		const def = getDefaultTextModel();
		expect(def.toolUse).toBe(true);
		expect(def.json).toBe(true);
	});

	it('cacheia entre chamadas e `force` refaz a cópia', () => {
		const a = getTextModelsCatalog(true);
		const b = getTextModelsCatalog();
		expect(b).toBe(a);
		const c = getTextModelsCatalog(true);
		expect(c).not.toBe(a);
		expect(c).toEqual(a);
	});

	describe('resolveTextModel', () => {
		it('devolve o modelo pedido quando ele existe', () => {
			const m = resolveTextModel('anthropic/claude-haiku-4.5');
			expect(m.id).toBe('anthropic/claude-haiku-4.5');
		});

		it('cai no padrão (sem lançar) quando o id é desconhecido', () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const m = resolveTextModel('vendor/modelo-que-nao-existe');
			expect(m.id).toBe(getDefaultTextModelId());
			expect(warn).toHaveBeenCalledOnce();
			warn.mockRestore();
		});

		it('cai no padrão quando nenhum id é passado', () => {
			expect(resolveTextModel(undefined).id).toBe(getDefaultTextModelId());
		});

		it('descarta modelo sem visão quando `needsVision`', () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const semVisao = TEXT_MODELS_CATALOG.find((m) => !m.vision);
			expect(
				semVisao,
				'o catálogo precisa de ao menos um modelo sem visão',
			).toBeDefined();
			const m = resolveTextModel(semVisao?.id, { needsVision: true });
			expect(m.vision).toBe(true);
			warn.mockRestore();
		});

		it('respeita o tier quando não há id explícito', () => {
			const m = resolveTextModel(undefined, { tier: 'fast' });
			expect(m.tierDefault).toBe('fast');
		});

		it('todo modelo resolvido com needsToolUse suporta ferramentas', () => {
			for (const entry of TEXT_MODELS_CATALOG) {
				const m = resolveTextModel(entry.id, { needsToolUse: true });
				expect(m.toolUse, `${entry.id} → ${m.id}`).toBe(true);
			}
		});
	});

	it('findTextModel devolve undefined para id desconhecido', () => {
		expect(findTextModel('nao/existe')).toBeUndefined();
	});
});
