import { describe, expect, it, vi } from 'vitest';
import { makeCache } from '../src/lib/redis.js';

function fakeClient() {
	const store = new Map<string, string>();
	return {
		store,
		get: vi.fn(async (k: string) => store.get(k) ?? null),
		set: vi.fn(async (k: string, v: string) => {
			store.set(k, v);
			return 'OK';
		}),
	};
}

describe('makeCache', () => {
	it('miss chama fetchFn e popula; hit não chama fetchFn', async () => {
		const client = fakeClient();
		const cache = makeCache(client as never);
		const fetchFn = vi.fn(async () => ({ n: 1 }));

		const a = await cache.cacheAside('k', 60, fetchFn);
		const b = await cache.cacheAside('k', 60, fetchFn);

		expect(a).toEqual({ n: 1 });
		expect(b).toEqual({ n: 1 });
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('fail-open: erro no get cai no fetchFn', async () => {
		const client = fakeClient();
		client.get.mockRejectedValueOnce(new Error('redis down'));
		const cache = makeCache(client as never);
		const v = await cache.cacheAside('k', 60, async () => 42);
		expect(v).toBe(42);
	});

	it('fail-open: erro no set ainda retorna o valor', async () => {
		const client = fakeClient();
		client.set.mockRejectedValueOnce(new Error('down'));
		const cache = makeCache(client as never);
		const v = await cache.cacheAside('k2', 60, async () => 7);
		expect(v).toBe(7);
	});
});
