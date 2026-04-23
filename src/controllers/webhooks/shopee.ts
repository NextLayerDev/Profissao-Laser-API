import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabase } from '../../lib/supabase.js';
import { normalizeVercelUrl } from '../../lib/vercel-url.js';
import { provisioningRepository } from '../../repositories/provisioning.js';

/**
 * Proxy de webhook da Shopee Open Platform para arquitetura multi-tenant.
 *
 * O painel da Shopee só aceita UMA "Push URL" por app — mas temos N deploys
 * Vercel (um por tenant). Esta rota recebe TODOS os pushes da Shopee, valida
 * a signature HMAC com `SHOPEE_PARTNER_KEY`, consulta `pl_tenant_shopee_shop`
 * (mapeado no OAuth forward de cada tenant) e forwarda o body original pro
 * deploy certo, marcando como verificado via `X-Internal-Secret` para o tenant
 * confiar sem revalidar a signature (cuja base inclui a URL pública, que muda
 * entre central e tenant).
 *
 * - Responde 200 imediato (Shopee reenvia se demorar / status != 2xx).
 * - Forward é fire-and-forget; erros ficam em log, não afetam o ACK.
 * - Não guarda nada do payload no banco central.
 */

type ShopeePush = {
	shop_id?: number | string;
	merchant_id?: number | string;
	code?: number;
	timestamp?: number;
	data?: Record<string, unknown>;
	[key: string]: unknown;
};

function parseBody(raw: Buffer): ShopeePush | null {
	try {
		return JSON.parse(raw.toString('utf-8')) as ShopeePush;
	} catch {
		return null;
	}
}

function verifyShopeeSignature(
	authHeader: string | undefined,
	partnerKey: string,
	fullUrl: string,
	rawBody: Buffer,
): boolean {
	if (!authHeader) return false;
	const expected = crypto
		.createHmac('sha256', partnerKey)
		.update(`${fullUrl}|${rawBody.toString('utf-8')}`)
		.digest('hex');
	try {
		const a = Buffer.from(expected, 'utf8');
		const b = Buffer.from(authHeader.trim(), 'utf8');
		if (a.length !== b.length) return false;
		return crypto.timingSafeEqual(a, b);
	} catch {
		return false;
	}
}

function resolveFullUrl(request: FastifyRequest): string {
	if (process.env.SHOPEE_OAUTH_CENTRAL_URL) {
		// Mesma URL base do callback OAuth — o webhook fica em /webhooks/shopee.
		// Construir a partir do origin garante bater com o que a Shopee assina.
		try {
			const origin = new URL(process.env.SHOPEE_OAUTH_CENTRAL_URL).origin;
			return `${origin}/webhooks/shopee`;
		} catch {
			// fallback abaixo
		}
	}
	const proto =
		(request.headers['x-forwarded-proto'] as string | undefined)?.split(
			',',
		)[0] || request.protocol;
	const host =
		(request.headers['x-forwarded-host'] as string | undefined)?.split(
			',',
		)[0] ||
		request.headers.host ||
		'';
	return `${proto}://${host}/webhooks/shopee`;
}

async function forwardToTenant(
	request: FastifyRequest,
	rawBuffer: Buffer,
	notification: ShopeePush,
	internalSecret: string,
): Promise<void> {
	const shopId = notification.shop_id;
	if (!shopId) {
		request.log.info(
			{ code: notification.code },
			'[shopee-webhook-proxy] sem shop_id no payload',
		);
		return;
	}

	const shopIdStr = String(shopId);

	const { data: mapping, error: lookupError } = await supabase
		.from('pl_tenant_shopee_shop')
		.select('tenant_slug, store_id')
		.eq('shop_id', shopIdStr)
		.maybeSingle();

	if (lookupError) {
		request.log.error(
			{ error: lookupError, shopIdStr },
			'[shopee-webhook-proxy] erro no lookup',
		);
		return;
	}

	if (!mapping) {
		request.log.warn(
			{ shopIdStr, code: notification.code },
			'[shopee-webhook-proxy] shop não mapeado — descartando',
		);
		return;
	}

	const tenant = await provisioningRepository.findTenantBySlug(
		mapping.tenant_slug,
	);
	if (!tenant || tenant.status !== 'active' || !tenant.vercel_url) {
		request.log.warn(
			{ slug: mapping.tenant_slug, status: tenant?.status },
			'[shopee-webhook-proxy] tenant inativo ou sem vercel_url',
		);
		return;
	}

	const origin = normalizeVercelUrl(tenant.vercel_url);
	const forwardUrl = `${origin}/api/ecommerce/shopee/webhook`;

	try {
		const resp = await fetch(forwardUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': internalSecret,
				'X-Shopee-Verified': 'true',
			},
			body: rawBuffer.toString('utf-8'),
		});
		request.log.info(
			{
				forwardUrl,
				status: resp.status,
				slug: mapping.tenant_slug,
				code: notification.code,
			},
			'[shopee-webhook-proxy] forward ok',
		);
	} catch (err) {
		request.log.error(
			{ err, forwardUrl, slug: mapping.tenant_slug },
			'[shopee-webhook-proxy] forward falhou',
		);
	}
}

export const handleShopeeWebhook = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const partnerKey = process.env.SHOPEE_PARTNER_KEY;
	const internalSecret = process.env.INTERNAL_REGISTER_SECRET;

	// ACK rápido — Shopee reenvia se demorar / status != 2xx
	reply.status(200).send({ received: true });

	if (!partnerKey) {
		request.log.error(
			'[shopee-webhook-proxy] SHOPEE_PARTNER_KEY não configurada',
		);
		return;
	}
	if (!internalSecret) {
		request.log.error(
			'[shopee-webhook-proxy] INTERNAL_REGISTER_SECRET não configurada',
		);
		return;
	}

	const body = request.body;
	const rawBuffer = Buffer.isBuffer(body)
		? body
		: Buffer.from(JSON.stringify(body ?? {}), 'utf-8');

	const fullUrl = resolveFullUrl(request);
	const authHeader = request.headers.authorization as string | undefined;

	if (!verifyShopeeSignature(authHeader, partnerKey, fullUrl, rawBuffer)) {
		request.log.warn(
			{ fullUrl, hasAuth: !!authHeader },
			'[shopee-webhook-proxy] signature inválida — descartando',
		);
		return;
	}

	const notification = parseBody(rawBuffer);
	if (!notification) {
		request.log.warn('[shopee-webhook-proxy] payload inválido, descartando');
		return;
	}

	// Fire-and-forget — não await
	setImmediate(() => {
		void forwardToTenant(request, rawBuffer, notification, internalSecret);
	});
};
