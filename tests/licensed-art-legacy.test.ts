import Fastify, { type FastifyInstance } from 'fastify';
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashCodigo } from '@/lib/license-code.js';

const repositorio = vi.hoisted(() => ({
	buscarPorCodigo: vi.fn(),
	listarDoCliente: vi.fn(),
	arquivarDoCliente: vi.fn(),
}));

vi.mock('@/repositories/licensed-art.js', () => repositorio);
vi.mock('@/lib/licensed-piece.js', () => ({
	ampliarLoteLicenciado: vi.fn(),
}));
vi.mock('@/repositories/licensed-brand.js', () => ({
	licensedBrandRepository: { findByFeatureKey: vi.fn(async () => null) },
}));
vi.mock('@/middleware/auth.js', () => ({
	authenticateCustomer: vi.fn(),
}));

const { licensedArtRoute } = await import('@/routes/licensed-art.js');

const CODIGO = 'PL-ABCDE-FGHIJ-KLMNO-PQRST';
const envOriginal = {
	origin: process.env.LICENSED_ART_LEGACY_ORIGIN,
	hashes: process.env.LICENSED_ART_LEGACY_CODE_HASHES,
};

function resposta(status: number, body?: unknown): Response {
	return {
		status,
		ok: status >= 200 && status < 300,
		json: vi.fn(async () => body),
	} as unknown as Response;
}

function verificacao(overrides: Record<string, unknown> = {}) {
	return {
		code: CODIGO,
		valid: true,
		status: 'active',
		content: 'Caneca oficial',
		featureKey: 'clube:corinthians',
		licensorName: 'Corinthians',
		brandName: 'Corinthians',
		crestUrl: 'https://cdn.example/crest.png',
		accentColor: '#000000',
		previewUrl: 'https://cdn.example/arte.png',
		issuedAt: '2026-09-01T00:00:00.000Z',
		checkedAt: '2026-09-09T00:00:00.000Z',
		...overrides,
	};
}

function arteLocal(overrides: Record<string, unknown> = {}) {
	return {
		code: CODIGO,
		feature_key: 'clube:corinthians',
		licensor_name: 'Corinthians',
		preview_url: null,
		prompt_title: 'Caneca oficial',
		revoked_at: null,
		created_at: '2026-09-01T00:00:00.000Z',
		...overrides,
	};
}

async function app(): Promise<FastifyInstance> {
	const server = Fastify().withTypeProvider<ZodTypeProvider>();
	server.setValidatorCompiler(validatorCompiler);
	server.setSerializerCompiler(serializerCompiler);
	await server.register(licensedArtRoute);
	return server;
}

beforeEach(() => {
	repositorio.buscarPorCodigo.mockReset().mockResolvedValue(null);
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

describe('ponte de QR legado', () => {
	it('consulta somente hash explicitamente permitido e projeta o DTO público', async () => {
		process.env.LICENSED_ART_LEGACY_ORIGIN =
			'https://dev.profissaolaser.example';
		process.env.LICENSED_ART_LEGACY_CODE_HASHES = hashCodigo(CODIGO);
		const fetchFalso = vi.fn(async () =>
			resposta(200, verificacao({ customer_id: 'nunca-pode-sair' })),
		);
		vi.stubGlobal('fetch', fetchFalso);

		const server = await app();
		const res = await server.inject({
			method: 'GET',
			url: `/api/licensed-art/${CODIGO}`,
		});

		expect(res.statusCode).toBe(200);
		expect(fetchFalso).toHaveBeenCalledWith(
			`https://dev.profissaolaser.example/api/licensed-art/${CODIGO}`,
			expect.objectContaining({
				method: 'GET',
				redirect: 'manual',
				headers: { accept: 'application/json' },
			}),
		);
		expect(res.json()).toEqual(verificacao());
		expect(res.json()).not.toHaveProperty('customer_id');
		await server.close();
	});

	it('não consulta dev para código fora da allowlist', async () => {
		process.env.LICENSED_ART_LEGACY_ORIGIN =
			'https://dev.profissaolaser.example';
		process.env.LICENSED_ART_LEGACY_CODE_HASHES = hashCodigo(
			'PL-ZZZZZ-YYYYY-XXXXX-WWWWW',
		);
		const fetchFalso = vi.fn();
		vi.stubGlobal('fetch', fetchFalso);

		const server = await app();
		const res = await server.inject({
			method: 'GET',
			url: `/api/licensed-art/${CODIGO}`,
		});

		expect(res.statusCode).toBe(404);
		expect(fetchFalso).not.toHaveBeenCalled();
		await server.close();
	});

	it('a licença local, até revogada, sempre vence a ponte', async () => {
		repositorio.buscarPorCodigo.mockResolvedValue(
			arteLocal({ revoked_at: '2026-09-02T00:00:00.000Z' }),
		);
		process.env.LICENSED_ART_LEGACY_ORIGIN =
			'https://dev.profissaolaser.example';
		process.env.LICENSED_ART_LEGACY_CODE_HASHES = hashCodigo(CODIGO);
		const fetchFalso = vi.fn();
		vi.stubGlobal('fetch', fetchFalso);

		const server = await app();
		const res = await server.inject({
			method: 'GET',
			url: `/api/licensed-art/${CODIGO}`,
		});

		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ valid: false, status: 'revoked' });
		expect(fetchFalso).not.toHaveBeenCalled();
		await server.close();
	});

	it.each([
		['falha de rede', async () => Promise.reject(new Error('offline'))],
		['payload malformado', async () => resposta(200, { code: CODIGO })],
		[
			'resposta inconsistente',
			async () =>
				resposta(200, verificacao({ code: 'PL-OUTRO', valid: false })),
		],
	])('devolve 502, e não 404, em %s do verificador', async (_nome, responder) => {
		process.env.LICENSED_ART_LEGACY_ORIGIN =
			'https://dev.profissaolaser.example';
		process.env.LICENSED_ART_LEGACY_CODE_HASHES = hashCodigo(CODIGO);
		vi.stubGlobal('fetch', vi.fn(responder));

		const server = await app();
		const res = await server.inject({
			method: 'GET',
			url: `/api/licensed-art/${CODIGO}`,
		});

		expect(res.statusCode).toBe(502);
		expect(res.json()).toEqual({
			message: 'Não foi possível verificar esta licença agora.',
			code: 'legacy_verifier_unavailable',
		});
		await server.close();
	});

	it('mantém 404 normal quando o verificador legado não encontra a licença', async () => {
		process.env.LICENSED_ART_LEGACY_ORIGIN =
			'https://dev.profissaolaser.example';
		process.env.LICENSED_ART_LEGACY_CODE_HASHES = hashCodigo(CODIGO);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => resposta(404)),
		);

		const server = await app();
		const res = await server.inject({
			method: 'GET',
			url: `/api/licensed-art/${CODIGO}`,
		});

		expect(res.statusCode).toBe(404);
		await server.close();
	});
});
