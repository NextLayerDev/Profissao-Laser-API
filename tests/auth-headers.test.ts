import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/stripe.js', () => ({ stripe: {} }));
vi.mock('../src/lib/supabase.js', () => ({
	supabase: { auth: { getUser: vi.fn() } },
}));
vi.mock('../src/lib/external-auth.js', () => ({
	fetchExternalUser: vi.fn(),
	isStaffRole: vi.fn(),
}));

import { authenticate } from '../src/middleware/auth.js';

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify();
	app.get('/whoami', { preHandler: [authenticate] }, async (req) => ({
		user: req.currentUser,
		role: req.currentRole,
	}));
	return app;
}

describe('authenticate (header-based)', () => {
	it('builds currentUser from trusted gateway headers', async () => {
		const app = await buildApp();
		const res = await app.inject({
			method: 'GET',
			url: '/whoami',
			headers: {
				'x-user-id': 'u-1',
				'x-user-email': 'a@b.com',
				'x-user-role': 'staff',
				'x-user-name': 'Tobias',
				'x-user-blocked': 'false',
			},
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({
			user: { id: 'u-1', email: 'a@b.com', role: 'staff', name: 'Tobias' },
			role: 'staff',
		});
		await app.close();
	});

	it('returns 403 for a blocked user', async () => {
		const app = await buildApp();
		const res = await app.inject({
			method: 'GET',
			url: '/whoami',
			headers: {
				'x-user-id': 'u-1',
				'x-user-email': 'a@b.com',
				'x-user-role': 'customer',
				'x-user-blocked': 'true',
			},
		});
		expect(res.statusCode).toBe(403);
		await app.close();
	});

	it('returns 401 when neither headers nor token are present', async () => {
		const app = await buildApp();
		const res = await app.inject({ method: 'GET', url: '/whoami' });
		expect(res.statusCode).toBe(401);
		await app.close();
	});
});
