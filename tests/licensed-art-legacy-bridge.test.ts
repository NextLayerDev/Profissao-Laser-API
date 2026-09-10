import crypto from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { licensedArtLegacyRoute } from '@/routes/licensed-art-legacy.js';

const CODIGO = 'PL-ABCDE-FGHIJ-KLMNO-PQRST';
const hash = (code: string) =>
	crypto
		.createHash('sha256')
		.update(code.trim().toUpperCase().replace(/\s+/g, ''))
		.digest('hex');
const envOriginal = {
	origin: process.env.LICENSED_ART_LEGACY_ORIGIN,
	hashes: process.env.LICENSED_ART_LEGACY_CODE_HASHES,
};

function response(status: number, body?: unknown): Response {
	return {
		status,
		ok: status >= 200 && status < 300,
		json: vi.fn(async () => body),
	} as unknown as Response;
}

function verification(overrides: Record<string, unknown> = {}) {
	return {
		code: CODIGO,
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

beforeEach(() => {
	delete process.env.LICENSED_ART_LEGACY_ORIGIN;
	delete process.env.LICENSED_ART_LEGACY_CODE_HASHES;
});

afterEach(() => {
	vi.unstubAllGlobals();
	if (envOriginal.origin === undefined)
		delete process.env.LICENSED_ART_LEGACY_ORIGIN;
	else process.env.LICENSED_ART_LEGACY_ORIGIN = envOriginal.origin;
	if (envOriginal.hashes === undefined)
		delete process.env.LICENSED_ART_LEGACY_CODE_HASHES;
	else process.env.LICENSED_ART_LEGACY_CODE_HASHES = envOriginal.hashes;
});

describe('ponte pública de QR legado', () => {
	it('só encaminha hashes allowlisted e projeta o DTO público', async () => {
		process.env.LICENSED_ART_LEGACY_ORIGIN =
			'https://dev.profissaolaser.example';
		process.env.LICENSED_ART_LEGACY_CODE_HASHES = hash(CODIGO);
		const fetchMock = vi.fn(async () =>
			response(200, verification({ customer_id: 'interno' })),
		);
		vi.stubGlobal('fetch', fetchMock);
		const server = await app();

		const res = await server.inject({
			method: 'GET',
			url: `/api/licensed-art/${CODIGO}`,
		});

		expect(res.statusCode).toBe(200);
		expect(fetchMock).toHaveBeenCalledWith(
			`https://dev.profissaolaser.example/api/licensed-art/${CODIGO}`,
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

	it('não faz chamada externa para hash não permitido', async () => {
		process.env.LICENSED_ART_LEGACY_ORIGIN =
			'https://dev.profissaolaser.example';
		process.env.LICENSED_ART_LEGACY_CODE_HASHES = hash(
			'PL-XXXXX-YYYYY-ZZZZZ-AAAAA',
		);
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const server = await app();

		const res = await server.inject({
			method: 'GET',
			url: `/api/licensed-art/${CODIGO}`,
		});

		expect(res.statusCode).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
		await server.close();
	});

	it.each([
		['falha de rede', async () => Promise.reject(new Error('offline'))],
		['payload inválido', async () => response(200, { code: CODIGO })],
		[
			'código divergente',
			async () => response(200, verification({ code: 'PL-OUTRO' })),
		],
	])('devolve 502 em %s do verificador legado', async (_nome, responder) => {
		process.env.LICENSED_ART_LEGACY_ORIGIN =
			'https://dev.profissaolaser.example';
		process.env.LICENSED_ART_LEGACY_CODE_HASHES = hash(CODIGO);
		vi.stubGlobal('fetch', vi.fn(responder));
		const server = await app();

		const res = await server.inject({
			method: 'GET',
			url: `/api/licensed-art/${CODIGO}`,
		});

		expect(res.statusCode).toBe(502);
		expect(res.json()).toMatchObject({
			code: 'legacy_verifier_unavailable',
		});
		await server.close();
	});
});
