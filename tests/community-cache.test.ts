import { beforeEach, describe, expect, it, vi } from 'vitest';

// withCapture só executa a função; mockamos para evitar Sentry real.
vi.mock('@/lib/sentry.js', () => ({
	withCapture: (fn: () => unknown) => fn(),
}));

// Repository mockado (mesmo módulo que o service importa).
vi.mock('@/repositories/community.js', () => ({
	communityRepository: {
		getStats: vi.fn(),
		getRanking: vi.fn(),
		listMembers: vi.fn(),
		listActivity: vi.fn(),
		listProjectsBase: vi.fn(),
		getProjectBase: vi.fn(),
		getLikedProjectIds: vi.fn(),
	},
}));

import { communityRepository } from '@/repositories/community.js';
import { communityService } from '@/services/community.js';

describe('communityService caching (no-op cache em teste)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('getStats delega ao repository', async () => {
		vi.mocked(communityRepository.getStats).mockResolvedValue({
			activeMembers: 1,
			completedProjects: 2,
			messagesSent: 3,
			livesRealized: 4,
		} as never);

		const out = await communityService.getStats();

		expect(out).toMatchObject({ activeMembers: 1 });
		expect(communityRepository.getStats).toHaveBeenCalledTimes(1);
	});

	it('listProjects: usa a base cacheável e aplica liked por customer', async () => {
		vi.mocked(communityRepository.listProjectsBase).mockResolvedValue([
			{ id: 'a', liked: false },
			{ id: 'b', liked: false },
		] as never);
		vi.mocked(communityRepository.getLikedProjectIds).mockResolvedValue(
			new Set(['b']),
		);

		const out = (await communityService.listProjects(
			1,
			10,
			undefined,
			'cust-1',
		)) as Array<{ id: string; liked: boolean }>;

		expect(communityRepository.listProjectsBase).toHaveBeenCalledWith(
			1,
			10,
			undefined,
		);
		expect(communityRepository.getLikedProjectIds).toHaveBeenCalledWith(
			['a', 'b'],
			'cust-1',
		);
		expect(out.find((p) => p.id === 'a')?.liked).toBe(false);
		expect(out.find((p) => p.id === 'b')?.liked).toBe(true);
	});

	it('listProjects: sem customer retorna a base sem tocar likes', async () => {
		vi.mocked(communityRepository.listProjectsBase).mockResolvedValue([
			{ id: 'a', liked: false },
		] as never);

		const out = (await communityService.listProjects(1, 10)) as Array<{
			id: string;
			liked: boolean;
		}>;

		expect(out).toEqual([{ id: 'a', liked: false }]);
		expect(communityRepository.getLikedProjectIds).not.toHaveBeenCalled();
	});

	it('getProject: aplica liked no detalhe quando há customer', async () => {
		vi.mocked(communityRepository.getProjectBase).mockResolvedValue({
			id: 'a',
			liked: false,
			commentList: [],
		} as never);
		vi.mocked(communityRepository.getLikedProjectIds).mockResolvedValue(
			new Set(['a']),
		);

		const out = (await communityService.getProject('a', 'cust-1')) as {
			id: string;
			liked: boolean;
		};

		expect(out.liked).toBe(true);
	});
});
