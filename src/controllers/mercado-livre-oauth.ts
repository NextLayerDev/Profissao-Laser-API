import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { provisioningRepository } from '../repositories/provisioning.js';

/**
 * Proxy OAuth do Mercado Livre para arquitetura multi-tenant.
 *
 * O ML exige que o `redirect_uri` bata exatamente com uma URI cadastrada no
 * DevCenter. Como temos N deploys Vercel (um por empresa), usamos esta API
 * central como ponto fixo: cada empresa manda `state = base64url({ slug, storeId })`
 * no authorize; aqui decodificamos, olhamos `pl_tenant.vercel_url` pelo slug
 * e redirecionamos o browser pro deploy correto com `code + storeId`, onde
 * a troca de code por token acontece no banco da própria empresa.
 *
 * Esta rota NÃO toca o banco central (só lê pl_tenant) e NÃO guarda tokens.
 */

const stateSchema = z.object({
	slug: z.string().min(1),
	storeId: z.string().min(1),
});

type CallbackQuery = {
	code?: string;
	state: string;
	error?: string;
	error_description?: string;
};

function decodeState(raw: string): z.infer<typeof stateSchema> | null {
	try {
		const json = Buffer.from(raw, 'base64url').toString('utf-8');
		const parsed = JSON.parse(json);
		return stateSchema.parse(parsed);
	} catch {
		return null;
	}
}

function normalizeVercelUrl(url: string): string {
	const trimmed = url.trim().replace(/\/$/, '');
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	return `https://${trimmed}`;
}

export const handleMercadoLivreCallback = async (
	request: FastifyRequest<{ Querystring: CallbackQuery }>,
	reply: FastifyReply,
) => {
	const { code, state, error, error_description } = request.query;

	const decoded = decodeState(state);
	if (!decoded) {
		return reply.status(400).send({
			message: 'Invalid state parameter — could not decode OAuth state',
		});
	}

	const { slug, storeId } = decoded;

	const tenant = await provisioningRepository.findTenantBySlug(slug);
	if (!tenant || tenant.status !== 'active' || !tenant.vercel_url) {
		return reply.status(404).send({
			message: `Tenant not found or inactive for slug: ${slug}`,
		});
	}

	const vercelUrl = normalizeVercelUrl(tenant.vercel_url);

	// Se o ML retornou erro, forwarda o erro pra página de connected do tenant.
	if (error || !code) {
		const errMsg = error_description || error || 'missing_code';
		const url = `${vercelUrl}/ecommerce/connected?status=error&reason=${encodeURIComponent(errMsg)}`;
		return reply.redirect(url, 302);
	}

	const forwardUrl = `${vercelUrl}/api/ecommerce/oauth/forward?code=${encodeURIComponent(code)}&storeId=${encodeURIComponent(storeId)}`;
	return reply.redirect(forwardUrl, 302);
};
