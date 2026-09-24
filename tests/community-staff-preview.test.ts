import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/stripe.js', () => ({ stripe: {} }));
vi.mock('../src/lib/supabase.js', () => ({
	supabase: { auth: { getUser: vi.fn() } },
}));
vi.mock('../src/lib/external-auth.js', () => ({
	fetchExternalUser: vi.fn(),
	fetchEntitlements: vi.fn(),
	isStaffRole: (role: string | null | undefined) =>
		role != null && ['staff', 'admin'].includes(role),
	isKnownAppRole: (role: string | null | undefined) =>
		role != null && ['customer', 'staff', 'admin'].includes(role),
}));

import { fetchEntitlements } from '../src/lib/external-auth.js';
import { authenticateCommunity } from '../src/middleware/auth.js';

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify();
	app.get('/room', { preHandler: [authenticateCommunity] }, async (req) => ({
		unlimited: req.isUnlimitedCustomer === true,
		planKey: req.currentPlanKey ?? null,
		customerId: req.currentCustomer?.id ?? null,
	}));
	return app;
}

const staffHeaders = {
	'x-user-id': 'staff-1',
	'x-user-email': 'staff@upvox.com',
	'x-user-role': 'staff',
	'x-user-blocked': 'false',
	authorization: 'Bearer tok',
};

beforeEach(() => {
	vi.mocked(fetchEntitlements).mockReset();
});

describe('authenticateCommunity — staff em Visão Aluno', () => {
	it('staff em prévia sai ilimitada e com a plan key sintética', async () => {
		vi.mocked(fetchEntitlements).mockResolvedValue({
			is_test_unlimited: true,
			subscription: { status: 'active', plan: { key: 'max', name: 'Max' } },
		});

		const app = await buildApp();
		const res = await app.inject({
			method: 'GET',
			url: '/room',
			headers: staffHeaders,
		});

		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({
			unlimited: true,
			planKey: 'max',
			customerId: 'staff-1',
		});
	});

	it('staff fora da prévia entra, mas não ilimitada e sem plano', async () => {
		vi.mocked(fetchEntitlements).mockResolvedValue({
			is_test_unlimited: false,
			subscription: null,
		});

		const app = await buildApp();
		const res = await app.inject({
			method: 'GET',
			url: '/room',
			headers: staffHeaders,
		});

		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({
			unlimited: false,
			planKey: null,
			customerId: 'staff-1',
		});
	});

	// Best-effort: upvox fora do ar NÃO pode barrar staff da comunidade.
	it('entitlements indisponível não bloqueia a staff', async () => {
		vi.mocked(fetchEntitlements).mockResolvedValue(null);

		const app = await buildApp();
		const res = await app.inject({
			method: 'GET',
			url: '/room',
			headers: staffHeaders,
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().unlimited).toBe(false);
	});

	it('customer sem assinatura ativa continua barrado com 403', async () => {
		vi.mocked(fetchEntitlements).mockResolvedValue({
			is_test_unlimited: false,
			subscription: null,
		});

		const app = await buildApp();
		const res = await app.inject({
			method: 'GET',
			url: '/room',
			headers: { ...staffHeaders, 'x-user-role': 'customer' },
		});

		expect(res.statusCode).toBe(403);
		expect(res.json().message).toBe('subscription_required');
	});
});
