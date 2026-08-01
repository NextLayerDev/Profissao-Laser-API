import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getProvider } from '../../lib/omni/providers/index.js';
import { incrWithTtl } from '../../lib/redis.js';
import { captureException } from '../../lib/sentry.js';
import { omniInstanceRepository } from '../../repositories/omni-instance.js';
import { omniInboxService } from '../../services/omni/inbox.js';

/**
 * Webhook PÚBLICO por instância: /api/omni/webhook/:instanceId/:secret.
 * Segurança: segredo de 32 bytes na URL comparado com timingSafeEqual; 404
 * uniforme (não vaza existência); rate-limit por instância. GET = verificação
 * da Meta (hub.challenge). POST = ACK imediato + processamento assíncrono
 * (Z-API/Meta reenviam em timeout — o dedupe por provider_message_id segura).
 */

function secretMatches(given: string, expected: string): boolean {
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
}

interface WebhookParams {
	instanceId: string;
	secret: string;
}

export async function omniWebhookVerifyController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { instanceId, secret } = request.params as WebhookParams;
	const instance = await omniInstanceRepository.findById(instanceId);
	if (!instance || !secretMatches(secret, instance.webhook_secret)) {
		return reply.status(404).send();
	}
	const q = request.query as Record<string, string | undefined>;
	const mode = q['hub.mode'];
	const token = q['hub.verify_token'];
	const challenge = q['hub.challenge'];
	if (
		mode === 'subscribe' &&
		token &&
		instance.meta_verify_token &&
		token === instance.meta_verify_token &&
		challenge
	) {
		return reply.type('text/plain').send(challenge);
	}
	return reply.status(404).send();
}

export async function omniWebhookController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { instanceId, secret } = request.params as WebhookParams;
	const instance = await omniInstanceRepository.findById(instanceId);
	if (
		!instance ||
		!instance.is_active ||
		!secretMatches(secret, instance.webhook_secret)
	) {
		return reply.status(404).send();
	}

	// Rate-limit por instância (fail-open sem Redis).
	const rate = await incrWithTtl(`omni:wh:${instanceId}`, 60);
	if (rate > 600) {
		console.warn(`[omni-webhook] rate-limit ${instanceId} (${rate}/min)`);
		return reply.send({ ok: true });
	}

	let events: ReturnType<ReturnType<typeof getProvider>['parseWebhook']> = [];
	try {
		events = getProvider(instance.provider).parseWebhook(request.body);
	} catch (err) {
		console.error('[omni-webhook] parse falhou:', err);
	}

	// ACK antes de processar (provedores reenviam em timeout).
	reply.send({ ok: true });
	if (events.length > 0) {
		setImmediate(() => {
			omniInboxService.ingestBatch(instance, events).catch((err) => {
				captureException(err as Error);
				console.error('[omni-webhook] ingest falhou:', err);
			});
		});
	}
}
