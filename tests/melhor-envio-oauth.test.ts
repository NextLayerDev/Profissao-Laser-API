import { beforeEach, describe, expect, it, vi } from 'vitest';

const findTenantBySlug = vi.fn();
vi.mock('../src/repositories/provisioning.js', () => ({
	provisioningRepository: {
		findTenantBySlug: (s: string) => findTenantBySlug(s),
	},
}));

const { decodeMelhorEnvioState, handleMelhorEnvioCallback } = await import(
	'../src/controllers/melhor-envio-oauth.js'
);

const estado = (o: unknown) =>
	Buffer.from(JSON.stringify(o)).toString('base64url');
const STATE = estado({ slug: 'metalaser', n: 'x'.repeat(32) });

function resposta() {
	const r = {
		code: 0,
		body: undefined as unknown,
		url: '',
		status(c: number) {
			r.code = c;
			return r;
		},
		send(b: unknown) {
			r.body = b;
			return r;
		},
		redirect(u: string, c: number) {
			r.url = u;
			r.code = c;
			return r;
		},
	};
	return r;
}

// biome-ignore lint/suspicious/noExplicitAny: fake do Fastify
const chamar = (query: any) => {
	const r = resposta();
	// biome-ignore lint/suspicious/noExplicitAny: fake do Fastify
	return handleMelhorEnvioCallback({ query } as any, r as any).then(() => r);
};

describe('proxy OAuth do Melhor Envio', () => {
	beforeEach(() => {
		findTenantBySlug.mockReset();
		findTenantBySlug.mockResolvedValue({
			status: 'active',
			vercel_url: 'metalaserpersonalizados.com/login',
		});
	});

	it('decodifica o state com slug e nonce', () => {
		expect(decodeMelhorEnvioState(STATE)?.slug).toBe('metalaser');
		expect(decodeMelhorEnvioState('lixo')).toBeNull();
		expect(
			decodeMelhorEnvioState(estado({ slug: 'a', n: 'curto' })),
		).toBeNull();
	});

	it('devolve code e o state intacto para o callback do tenant', async () => {
		const r = await chamar({ code: 'abc', state: STATE });
		expect(findTenantBySlug).toHaveBeenCalledWith('metalaser');
		expect(r.code).toBe(302);
		const u = new URL(r.url);
		expect(u.origin).toBe('https://metalaserpersonalizados.com');
		expect(u.pathname).toBe('/api/melhor-envio/oauth/callback');
		expect(u.searchParams.get('code')).toBe('abc');
		expect(u.searchParams.get('state')).toBe(STATE);
	});

	it('repassa o erro (autorização negada) sem code', async () => {
		const r = await chamar({ state: STATE, error: 'access_denied' });
		const u = new URL(r.url);
		expect(u.searchParams.get('error')).toBe('access_denied');
		expect(u.searchParams.get('code')).toBeNull();
	});

	it('400 com state inválido e 404 com tenant inativo', async () => {
		expect((await chamar({ code: 'a', state: 'x' })).code).toBe(400);
		findTenantBySlug.mockResolvedValue({
			status: 'suspended',
			vercel_url: 'x.com',
		});
		expect((await chamar({ code: 'a', state: STATE })).code).toBe(404);
	});
});
