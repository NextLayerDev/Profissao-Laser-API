import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { normalizeVercelUrl } from '../lib/vercel-url.js';
import { provisioningRepository } from '../repositories/provisioning.js';

/**
 * Proxy OAuth do Melhor Envio para a arquitetura multi-tenant (mesmo molde do
 * Mercado Livre).
 *
 * O app de produção do Melhor Envio tem UMA URL de retorno cadastrada: esta.
 * Cada deploy do system_porteira manda `state = base64url({ slug, n })` no
 * authorize; aqui decodificamos, olhamos `pl_tenant.vercel_url` pelo slug e
 * devolvemos o navegador ao deploy certo com `code` e o `state` intacto — lá o
 * state é conferido contra o cookie (anti-CSRF) e o code é trocado por token
 * no banco da própria empresa.
 *
 * Esta rota NÃO toca o banco central (só lê pl_tenant) e NÃO guarda tokens.
 */

const stateSchema = z.object({
	slug: z.string().min(1),
	n: z.string().min(16),
});

type CallbackQuery = {
	code?: string;
	state: string;
	error?: string;
	error_description?: string;
};

export function decodeMelhorEnvioState(
	raw: string,
): z.infer<typeof stateSchema> | null {
	try {
		const json = Buffer.from(raw, 'base64url').toString('utf-8');
		return stateSchema.parse(JSON.parse(json));
	} catch {
		return null;
	}
}

const CAMINHO_CALLBACK_TENANT = '/api/melhor-envio/oauth/callback';

export const handleMelhorEnvioCallback = async (
	request: FastifyRequest<{ Querystring: CallbackQuery }>,
	reply: FastifyReply,
) => {
	const { code, state, error, error_description } = request.query;

	const decoded = decodeMelhorEnvioState(state);
	if (!decoded) {
		return reply.status(400).send({
			message: 'Invalid state parameter — could not decode OAuth state',
		});
	}

	const tenant = await provisioningRepository.findTenantBySlug(decoded.slug);
	if (!tenant || tenant.status !== 'active' || !tenant.vercel_url) {
		return reply.status(404).send({
			message: `Tenant not found or inactive for slug: ${decoded.slug}`,
		});
	}

	const params = new URLSearchParams({ state });
	if (error || !code) {
		// O callback do tenant mostra "autorização cancelada" no popup.
		params.set('error', error_description || error || 'missing_code');
	} else {
		params.set('code', code);
	}
	const destino = `${normalizeVercelUrl(tenant.vercel_url)}${CAMINHO_CALLBACK_TENANT}?${params.toString()}`;
	return reply.redirect(destino, 302);
};
