import { describe, expect, it } from 'vitest';
import {
	findImageModel,
	getDefaultImageModel,
	getDefaultImageModelId,
	getImageModelsCatalog,
	IMAGE_MODELS_CATALOG,
} from '../src/lib/image-models-catalog.js';

describe('image-models-catalog', () => {
	it('tem exatamente um modelo marcado como padrão', () => {
		const defaults = IMAGE_MODELS_CATALOG.filter((m) => m.default);
		expect(defaults).toHaveLength(1);
		expect(getDefaultImageModelId()).toBe(defaults[0]?.id);
		expect(getDefaultImageModel().id).toBe(defaults[0]?.id);
	});

	it('não tem ids duplicados', () => {
		const ids = IMAGE_MODELS_CATALOG.map((m) => m.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('todo id segue o formato `vendor/modelo` do OpenRouter', () => {
		// Guarda contra o erro que já aconteceu neste catálogo: id escrito de
		// memória, sem barra, que só quebrava em runtime (ver check-model-catalogs.ts).
		for (const m of IMAGE_MODELS_CATALOG) {
			expect(m.id, m.id).toMatch(/^[a-z0-9-]+\/[a-zA-Z0-9._-]+$/);
		}
	});

	it('todo modelo com unifiedImagesApi:true tem pelo menos 1 lever real (aspect_ratio ou quality)', () => {
		// Confirmado empiricamente (2026-08-01) que TODO o catálogo atual tem
		// unifiedImagesApi:true — mas cada modelo tem um subconjunto diferente
		// de controles reais (Gemini: aspect_ratio+resolution; GPT: quality).
		// Sem NENHUM dos dois, o campo unifiedImagesApi não traria ganho real.
		for (const m of IMAGE_MODELS_CATALOG.filter((e) => e.unifiedImagesApi)) {
			const hasLever =
				(m.apiAspectRatios?.length ?? 0) > 0 || (m.apiQuality?.length ?? 0) > 0;
			expect(hasLever, m.id).toBe(true);
		}
	});

	it('apiResolutions só existe em modelos que também têm apiAspectRatios (família Gemini)', () => {
		for (const m of IMAGE_MODELS_CATALOG.filter(
			(e) => e.apiResolutions?.length,
		)) {
			expect(m.apiAspectRatios?.length, m.id).toBeGreaterThan(0);
		}
	});

	it('findImageModel devolve undefined pra id desconhecido', () => {
		expect(findImageModel('nao/existe')).toBeUndefined();
	});

	it('findImageModel devolve a entrada certa pra um id conhecido', () => {
		const m = findImageModel('openai/gpt-5.4-image-2');
		expect(m?.quality).toBe('top');
		expect(m?.apiQuality).toContain('high');
		expect(m?.apiAspectRatios).toBeUndefined();
	});

	it('cacheia entre chamadas e `force` refaz a cópia', () => {
		const a = getImageModelsCatalog(true);
		const b = getImageModelsCatalog();
		expect(b).toBe(a);
		const c = getImageModelsCatalog(true);
		expect(c).not.toBe(a);
		expect(c).toEqual(a);
	});
});
