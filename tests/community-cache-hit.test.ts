import { describe, expect, it, vi } from 'vitest';

// Cache stateful em memória: 2º call com a mesma chave é HIT (não chama fetchFn).
vi.mock('@/lib/redis.js', () => {
	const store = new Map<string, unknown>();
	return {
		cache: {
			async cacheAside(
				key: string,
				_ttl: number,
				fetchFn: () => Promise<unknown>,
			) {
				if (store.has(key)) return store.get(key);
				const value = await fetchFn();
				store.set(key, value);
				return value;
			},
		},
	};
});

vi.mock('@/lib/sentry.js', () => ({
	withCapture: (fn: () => unknown) => fn(),
}));

vi.mock('@/repositories/community.js', () => ({
	communityRepository: {
		listProjectsBase: vi.fn(),
		getLikedProjectIds: vi.fn(),
	},
}));

import { communityRepository } from '@/repositories/community.js';
import { communityService } from '@/services/community.js';

describe('communityService — base cacheada com overlay por request (cache HIT)', () => {
	it('no 2º call a base vem do cache, mas o liked é recalculado por usuário', async () => {
		vi.mocked(communityRepository.listProjectsBase).mockResolvedValue([
			{ id: 'a', liked: false },
			{ id: 'b', liked: false },
		] as never);
		// Usuário 1 curtiu 'b'; usuário 2 curtiu 'a'.
		vi.mocked(communityRepository.getLikedProjectIds)
			.mockResolvedValueOnce(new Set(['b']))
			.mockResolvedValueOnce(new Set(['a']));

		const first = (await communityService.listProjects(
			1,
			10,
			undefined,
			'cust-1',
		)) as Array<{ id: string; liked: boolean }>;
		const second = (await communityService.listProjects(
			1,
			10,
			undefined,
			'cust-2',
		)) as Array<{ id: string; liked: boolean }>;

		// A query cara só roda uma vez (2º é cache hit).
		expect(communityRepository.listProjectsBase).toHaveBeenCalledTimes(1);
		// O overlay roda em todo request.
		expect(communityRepository.getLikedProjectIds).toHaveBeenCalledTimes(2);

		// Cada usuário vê o próprio liked sobre a MESMA base cacheada.
		expect(first.find((p) => p.id === 'b')?.liked).toBe(true);
		expect(first.find((p) => p.id === 'a')?.liked).toBe(false);
		expect(second.find((p) => p.id === 'a')?.liked).toBe(true);
		expect(second.find((p) => p.id === 'b')?.liked).toBe(false);
	});
});
