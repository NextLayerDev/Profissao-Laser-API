import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { normalizeVercelUrl } from '../lib/vercel-url.js';
import { provisioningRepository } from '../repositories/provisioning.js';

/**
 * Proxy OAuth da Shopee Open Platform para arquitetura multi-tenant.
 *
 * Mesmo padrão do callback ML: temos N deploys Vercel, mas o painel da Shopee
 * só aceita UMA `redirect_url` cadastrada por app. Então cada empresa manda
 * `state = base64url({ slug, storeId })` no authorize; aqui decodificamos,
 * olhamos `pl_tenant.vercel_url` pelo slug e redirecionamos o browser pro
 * deploy correto com `code + shop_id + storeId`. A troca de code por token
 * acontece no banco da própria empresa (rota `/api/ecommerce/shopee/oauth/forward`).
 *
 * Esta rota NÃO toca o banco central (só lê pl_tenant) e NÃO guarda tokens.
 */

const stateSchema = z.object({
	slug: z.string().min(1),
	storeId: z.string().min(1),
});

type CallbackQuery = {
	code?: string;
	shop_id?: string;
	state: string;
	error?: string;
	message?: string;
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

export const handleShopeeCallback = async (
	request: FastifyRequest<{ Querystring: CallbackQuery }>,
	reply: FastifyReply,
) => {
	const { code, shop_id, state, error, message } = request.query;

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

	// Erro retornado pela Shopee — forwarda pra página de connected do tenant.
	if (error || !code || !shop_id) {
		const errMsg = message || error || 'missing_code_or_shop_id';
		const url = `${vercelUrl}/ecommerce/connected?status=error&platform=shopee&reason=${encodeURIComponent(errMsg)}`;
		return reply.redirect(url, 302);
	}

	const forwardUrl =
		`${vercelUrl}/api/ecommerce/shopee/oauth/forward` +
		`?code=${encodeURIComponent(code)}` +
		`&shop_id=${encodeURIComponent(shop_id)}` +
		`&storeId=${encodeURIComponent(storeId)}`;
	return reply.redirect(forwardUrl, 302);
};
