import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabase } from '../../lib/supabase.js';
import { normalizeVercelUrl } from '../../lib/vercel-url.js';
import { provisioningRepository } from '../../repositories/provisioning.js';

/**
 * Proxy de webhook do Mercado Livre para arquitetura multi-tenant.
 *
 * O ML só aceita UMA webhook URL por app no DevCenter — mas temos N deploys
 * Vercel (um por tenant). Esta rota recebe TODOS os eventos ML, consulta
 * `pl_tenant_ml_seller` (mapeado no OAuth forward de cada tenant) e forwarda
 * o body original pro deploy certo.
 *
 * - Responde 200 imediatamente (ML reenvia se demorar).
 * - Forward é fire-and-forget; erros ficam em log, não afetam o ACK pro ML.
 * - Não guarda nada de payload no banco central.
 */

type MLNotification = {
	resource?: string;
	topic?: string;
	user_id?: number | string;
	[key: string]: unknown;
};

function parseBody(raw: unknown): MLNotification | null {
	if (!raw) return null;
	if (Buffer.isBuffer(raw)) {
		try {
			return JSON.parse(raw.toString('utf-8')) as MLNotification;
		} catch {
			return null;
		}
	}
	if (typeof raw === 'object') return raw as MLNotification;
	if (typeof raw === 'string') {
		try {
			return JSON.parse(raw) as MLNotification;
		} catch {
			return null;
		}
	}
	return null;
}

async function forwardToTenant(
	request: FastifyRequest,
	rawBuffer: Buffer,
	notification: MLNotification,
): Promise<void> {
	const userId = notification.user_id;
	if (!userId) {
		request.log.info(
			{ notification },
			'[ml-webhook-proxy] sem user_id no payload',
		);
		return;
	}

	const sellerIdStr = String(userId);

	const { data: mapping, error: lookupError } = await supabase
		.from('pl_tenant_ml_seller')
		.select('tenant_slug, store_id')
		.eq('seller_id', sellerIdStr)
		.maybeSingle();

	if (lookupError) {
		request.log.error(
			{ error: lookupError, sellerIdStr },
			'[ml-webhook-proxy] erro no lookup',
		);
		return;
	}

	if (!mapping) {
		request.log.warn(
			{ sellerIdStr, topic: notification.topic },
			'[ml-webhook-proxy] seller não mapeado — descartando',
		);
		return;
	}

	const tenant = await provisioningRepository.findTenantBySlug(
		mapping.tenant_slug,
	);
	if (!tenant || tenant.status !== 'active' || !tenant.vercel_url) {
		request.log.warn(
			{ slug: mapping.tenant_slug, status: tenant?.status },
			'[ml-webhook-proxy] tenant inativo ou sem vercel_url',
		);
		return;
	}

	const origin = normalizeVercelUrl(tenant.vercel_url);
	const forwardUrl = `${origin}/api/ecommerce/webhook`;

	try {
		const resp = await fetch(forwardUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: rawBuffer.toString('utf-8'),
		});
		request.log.info(
			{
				forwardUrl,
				status: resp.status,
				slug: mapping.tenant_slug,
				topic: notification.topic,
			},
			'[ml-webhook-proxy] forward ok',
		);
	} catch (err) {
		request.log.error(
			{ err, forwardUrl, slug: mapping.tenant_slug },
			'[ml-webhook-proxy] forward falhou',
		);
	}
}

export const handleMercadoLivreWebhook = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const body = request.body;
	const rawBuffer = Buffer.isBuffer(body)
		? body
		: Buffer.from(JSON.stringify(body ?? {}), 'utf-8');

	const notification = parseBody(body);

	// ACK rápido — ML reenvia se demorar
	reply.status(200).send({ received: true });

	if (!notification) {
		request.log.warn('[ml-webhook-proxy] payload inválido, descartando');
		return;
	}

	// Fire-and-forget — não await
	setImmediate(() => {
		void forwardToTenant(request, rawBuffer, notification);
	});
};
