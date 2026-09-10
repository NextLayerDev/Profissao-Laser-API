import Fastify, { type FastifyInstance } from 'fastify';
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import { licensedArtLegacyRoute } from '@/routes/licensed-art-legacy.js';

const CODIGO_AUDITADO = 'PL-XCVYE-C4SZS-JEB6Y-FKMJR';
async function app(): Promise<FastifyInstance> {
	const server = Fastify().withTypeProvider<ZodTypeProvider>();
	server.setValidatorCompiler(validatorCompiler);
	server.setSerializerCompiler(serializerCompiler);
	await server.register(licensedArtLegacyRoute);
	return server;
}
describe('registro público de QR legado', () => {
	it('resolve QR auditado inteiramente local, sem chamada externa', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const server = await app();
		const res = await server.inject({
			method: 'GET',
			url: `/api/licensed-art/${CODIGO_AUDITADO}`,
		});
		expect(res.statusCode).toBe(200);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(res.json()).toMatchObject({
			code: CODIGO_AUDITADO,
			valid: true,
			status: 'active',
		});
		expect(res.json().checkedAt).toEqual(expect.any(String));
		await server.close();
	});
	it('aceita caixa e espaços canônicos sem chamada externa', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const server = await app();
		const res = await server.inject({
			method: 'GET',
			url: `/api/licensed-art/%20${CODIGO_AUDITADO.toLowerCase()}%20`,
		});
		expect(res.statusCode).toBe(200);
		expect(fetchMock).not.toHaveBeenCalled();
		await server.close();
	});
	it('não encontra código fora do registro local', async () => {
		vi.stubGlobal('fetch', vi.fn());
		const server = await app();
		const res = await server.inject({
			method: 'GET',
			url: '/api/licensed-art/PL-XXXXX-YYYYY-ZZZZZ-AAAAA',
		});
		expect(res.statusCode).toBe(404);
		expect(res.json()).toMatchObject({ code: 'not_found' });
		await server.close();
	});
});
