import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorSchema } from '../types/error.js';

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

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const TIMEOUT_MS = 5_000;

const normalizarCodigo = (code: string): string =>
	code.trim().toUpperCase().replace(/\s+/g, '');

// Mantém o mesmo SHA-256 do emissor de licenças em dev, sem trazer a feature
// inteira para a base de produção que só precisa resolver QR já gravado.
const hashCodigo = (code: string): string =>
	crypto.createHash('sha256').update(normalizarCodigo(code)).digest('hex');

function configuracaoLegada(): { origin: string; hashes: Set<string> } | null {
	const originRaw = process.env.LICENSED_ART_LEGACY_ORIGIN?.trim();
	const hashesRaw = process.env.LICENSED_ART_LEGACY_CODE_HASHES?.trim();
	if (!originRaw || !hashesRaw) return null;

	let origin: URL;
	try {
		origin = new URL(originRaw);
	} catch {
		return null;
	}
	if (
		origin.protocol !== 'https:' ||
		origin.username ||
		origin.password ||
		origin.pathname !== '/' ||
		origin.search ||
		origin.hash
	) {
		return null;
	}

	const hashes = hashesRaw.split(/[\s,]+/).filter(Boolean);
	if (
		hashes.length === 0 ||
		hashes.some((hash) => !hashSchema.safeParse(hash).success)
	) {
		return null;
	}
	return { origin: origin.origin, hashes: new Set(hashes) };
}

/**
 * Ponte temporária para QR imutável: somente hashes explicitamente permitidos
 * podem consultar o verificador público dev. Não recebe nem repassa tokens,
 * cookies ou cabeçalhos do visitante.
 */
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
					502: ErrorSchema,
				},
				tags: ['Licensed Art'],
			},
		},
		async (request, reply) => {
			const { code } = request.params as z.infer<typeof codigoParams>;
			const config = configuracaoLegada();
			if (!config?.hashes.has(hashCodigo(code))) {
				return reply
					.status(404)
					.send({ message: 'Código não encontrado.', code: 'not_found' });
			}

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
			let response: Response;
			try {
				response = await fetch(
					`${config.origin}/api/licensed-art/${encodeURIComponent(code)}`,
					{
						method: 'GET',
						redirect: 'manual',
						signal: controller.signal,
						headers: { accept: 'application/json' },
					},
				);
			} catch (err) {
				request.log.error({ err }, 'verificador legado indisponível');
				return reply.status(502).send({
					message: 'Não foi possível verificar esta licença agora.',
					code: 'legacy_verifier_unavailable',
				});
			} finally {
				clearTimeout(timeout);
			}

			if (response.status === 404) {
				return reply
					.status(404)
					.send({ message: 'Código não encontrado.', code: 'not_found' });
			}
			if (!response.ok) {
				return reply.status(502).send({
					message: 'Não foi possível verificar esta licença agora.',
					code: 'legacy_verifier_unavailable',
				});
			}

			let body: unknown;
			try {
				body = await response.json();
			} catch {
				body = null;
			}
			const verification = verificacaoSchema.safeParse(body);
			if (
				!verification.success ||
				normalizarCodigo(verification.data.code) !== normalizarCodigo(code) ||
				verification.data.valid !== (verification.data.status === 'active')
			) {
				return reply.status(502).send({
					message: 'Não foi possível verificar esta licença agora.',
					code: 'legacy_verifier_unavailable',
				});
			}

			// safeParse projeta apenas o DTO público, descartando campos internos.
			reply.header('Cache-Control', 'public, max-age=60');
			return reply.send(verification.data);
		},
	);
}
