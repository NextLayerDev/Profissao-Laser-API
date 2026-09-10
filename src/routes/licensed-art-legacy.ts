import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorSchema } from '../types/error.js';
import { LEGACY_LICENSED_ART_BY_HASH } from './licensed-art-legacy-manifest.js';

const codigoParams = z.object({ code: z.string().min(6).max(64) });
const verificacaoSchema = z.object({
	code: z.string(),
	valid: z.boolean(),
	status: z.enum(['active', 'revoked']),
	content: z.string(),
	featureKey: z.string(),
	licensorName: z.string().nullable(),
	brandName: z.string().nullable(),
	crestUrl: z.string().nullable(),
	accentColor: z.string().nullable(),
	previewUrl: z.string().nullable(),
	issuedAt: z.string(),
	checkedAt: z.string(),
});
const normalizarCodigo = (code: string) =>
	code.trim().toUpperCase().replace(/\s+/g, '');
const hashCodigo = (code: string) =>
	crypto.createHash('sha256').update(normalizarCodigo(code)).digest('hex');

const snapshotSchema = verificacaoSchema.omit({ checkedAt: true });

for (const [hash, snapshot] of LEGACY_LICENSED_ART_BY_HASH) {
	if (
		!/^[a-f0-9]{64}$/.test(hash) ||
		hashCodigo(snapshot.code) !== hash ||
		!snapshotSchema.safeParse(snapshot).success ||
		snapshot.valid !== (snapshot.status === 'active')
	) {
		throw new Error('Manifesto de licenças legadas inválido.');
	}
}

export async function licensedArtLegacyRoute(server: FastifyInstance) {
	server.get(
		'/api/licensed-art/:code',
		{
			schema: {
				description: 'Verificação pública de QR legado autorizado.',
				params: codigoParams,
				response: {
					200: verificacaoSchema,
					404: ErrorSchema,
				},
				tags: ['Licensed Art'],
			},
		},
		async (request, reply) => {
			const { code } = request.params as z.infer<typeof codigoParams>;
			const snapshot = LEGACY_LICENSED_ART_BY_HASH.get(hashCodigo(code));
			if (!snapshot) {
				return reply
					.status(404)
					.send({ message: 'Código não encontrado.', code: 'not_found' });
			}
			reply.header('Cache-Control', 'public, max-age=60');
			return reply.send({ ...snapshot, checkedAt: new Date().toISOString() });
		},
	);
}
