import Fastify, { type FastifyInstance } from 'fastify';
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { licensedArtLegacyRoute } from '@/routes/licensed-art-legacy.js';

const CODIGO_AUDITADO = 'PL-XCVYE-C4SZS-JEB6Y-FKMJR';
function response(status: number, body?: unknown): Response {
	return {
		status,
		ok: status >= 200 && status < 300,
		json: vi.fn(async () => body),
	} as unknown as Response;
}
function verification(overrides: Record<string, unknown> = {}) {
	return {
		code: CODIGO_AUDITADO,
		valid: true,
		status: 'active',
		content: 'Caneca oficial',
		featureKey: 'clube:corinthians',
		licensorName: 'Corinthians',
		brandName: 'Corinthians',
		crestUrl: null,
		accentColor: null,
		previewUrl: null,
		issuedAt: '2026-09-01T00:00:00.000Z',
		checkedAt: '2026-09-09T00:00:00.000Z',
		...overrides,
	};
}
async function app(): Promise<FastifyInstance> {
	const server = Fastify().withTypeProvider<ZodTypeProvider>();
	server.setValidatorCompiler(validatorCompiler);
	server.setSerializerCompiler(serializerCompiler);
	await server.register(licensedArtLegacyRoute);
	return server;
}
afterEach(() => vi.unstubAllGlobals());
describe('ponte pública de QR legado', () => {
	it('encaminha QR auditado e projeta somente o DTO público', async () => {
		const fetchMock = vi.fn(async () =>
			response(200, verification({ customer_id: 'interno' })),
		);
		vi.stubGlobal('fetch', fetchMock);
		const server = await app();
		const res = await server.inject({
			method: 'GET',
			url: `/api/licensed-art/${CODIGO_AUDITADO}`,
		});
		expect(res.statusCode).toBe(200);
		expect(fetchMock).toHaveBeenCalledWith(
			`https://profissao-laser-profissao-laser-back-dev.1nwz76.easypanel.host/api/licensed-art/${CODIGO_AUDITADO}`,
			expect.objectContaining({
				method: 'GET',
				redirect: 'manual',
				headers: { accept: 'application/json' },
			}),
		);
		expect(res.json()).toEqual(verification());
		expect(res.json()).not.toHaveProperty('customer_id');
		await server.close();
	});
	it('não faz chamada externa para código não auditado', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const server = await app();
		const res = await server.inject({
			method: 'GET',
			url: '/api/licensed-art/PL-XXXXX-YYYYY-ZZZZZ-AAAAA',
		});
		expect(res.statusCode).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
		await server.close();
	});
	it.each([
		['falha de rede', async () => Promise.reject(new Error('offline'))],
		['payload inválido', async () => response(200, { code: CODIGO_AUDITADO })],
		[
			'código divergente',
			async () => response(200, verification({ code: 'PL-OUTRO' })),
		],
	])('devolve 502 em %s do verificador legado', async (_nome, responder) => {
		vi.stubGlobal('fetch', vi.fn(responder));
		const server = await app();
		const res = await server.inject({
			method: 'GET',
			url: `/api/licensed-art/${CODIGO_AUDITADO}`,
		});
		expect(res.statusCode).toBe(502);
		expect(res.json()).toMatchObject({ code: 'legacy_verifier_unavailable' });
		await server.close();
	});
});
