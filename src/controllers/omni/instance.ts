import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { encrypt } from '../../lib/crypto.js';
import { isAdminRole } from '../../lib/external-auth.js';
import {
	buildProviderCtx,
	getProvider,
} from '../../lib/omni/providers/index.js';
import { omniChatRepository } from '../../repositories/omni-chat.js';
import { omniInstanceRepository } from '../../repositories/omni-instance.js';
import { resolveInstanceAccess, sanitizeInstance } from './access.js';

interface IdParams {
	id: string;
}

export async function listInstancesController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const user = request.currentUser;
	if (!user) return reply.status(401).send({ message: 'Not authenticated' });
	const rows = isAdminRole(request.currentRole)
		? await omniInstanceRepository.listAll()
		: await omniInstanceRepository.listByOwner(user.id);
	return reply.send(rows.map(sanitizeInstance));
}

export async function createInstanceController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const user = request.currentUser;
	if (!user) return reply.status(401).send({ message: 'Not authenticated' });
	const body = (request.body ?? {}) as {
		provider?: 'zapi' | 'evolution' | 'meta';
		name?: string;
		credentials?: {
			meta_phone_number_id?: string;
			meta_waba_token?: string;
			meta_verify_token?: string;
			meta_app_secret?: string;
		};
	};
	if (
		!body.provider ||
		!['zapi', 'evolution', 'meta'].includes(body.provider)
	) {
		return reply.status(400).send({ message: 'provider inválido' });
	}
	if (body.provider === 'meta') {
		const c = body.credentials;
		if (
			!c?.meta_phone_number_id ||
			!c?.meta_waba_token ||
			!c?.meta_verify_token
		) {
			return reply.status(400).send({
				message:
					'Meta exige meta_phone_number_id, meta_waba_token e meta_verify_token',
			});
		}
	}
	const row = await omniInstanceRepository.create({
		owner_id: user.id,
		name: body.name?.trim() || 'Minha instância',
		provider: body.provider,
		webhook_secret: crypto.randomBytes(32).toString('hex'),
		...(body.provider === 'meta'
			? {
					meta_phone_number_id: body.credentials?.meta_phone_number_id,
					meta_waba_token: encrypt(body.credentials?.meta_waba_token ?? ''),
					meta_verify_token: body.credentials?.meta_verify_token,
					meta_app_secret: body.credentials?.meta_app_secret
						? encrypt(body.credentials.meta_app_secret)
						: null,
				}
			: {}),
	});
	return reply.status(201).send(sanitizeInstance(row));
}

export async function getInstanceController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as IdParams;
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	return reply.send(sanitizeInstance(instance));
}

export async function updateInstanceController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as IdParams;
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	const body = (request.body ?? {}) as {
		name?: string;
		ia_enabled?: boolean;
		debounce_seconds?: number;
		billing_status?: string;
	};
	const patch: Record<string, unknown> = {};
	if (typeof body.name === 'string' && body.name.trim()) {
		patch.name = body.name.trim();
	}
	if (typeof body.ia_enabled === 'boolean') patch.ia_enabled = body.ia_enabled;
	if (
		typeof body.debounce_seconds === 'number' &&
		body.debounce_seconds >= 2 &&
		body.debounce_seconds <= 30
	) {
		patch.debounce_seconds = Math.round(body.debounce_seconds);
	}
	// Só permite REATIVAR (voltar pra 'ok' após recarga); 'no_balance' é do motor.
	if (body.billing_status === 'ok') patch.billing_status = 'ok';
	const updated = await omniInstanceRepository.update(id, patch);
	return reply.send(sanitizeInstance(updated));
}

export async function deleteInstanceController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as IdParams;
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	try {
		const provider = getProvider(instance.provider);
		await provider.disconnect?.(buildProviderCtx(instance));
	} catch {
		// best-effort
	}
	await omniInstanceRepository.softDelete(id);
	return reply.status(204).send();
}

export async function connectInstanceController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as IdParams;
	let instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	const provider = getProvider(instance.provider);
	try {
		// 1) cria a instância remota se ainda não existe (zapi/evolution)
		if (instance.provider === 'zapi' && !instance.zapi_instance_id) {
			const created = await provider.createRemoteInstance?.(
				`pl_omni_${instance.id.slice(0, 8)}`,
			);
			if (created?.zapiInstanceId && created.zapiToken) {
				instance = await omniInstanceRepository.update(id, {
					zapi_instance_id: created.zapiInstanceId,
					zapi_instance_token: encrypt(created.zapiToken),
					setup_status: 'provider_created',
				});
			}
		} else if (
			instance.provider === 'evolution' &&
			!instance.evolution_instance
		) {
			const created = await provider.createRemoteInstance?.(
				`pl_omni_${instance.id.slice(0, 8)}`,
			);
			if (created?.evolutionInstance) {
				instance = await omniInstanceRepository.update(id, {
					evolution_instance: created.evolutionInstance,
					setup_status: 'provider_created',
				});
			}
		}

		// 2) aponta o webhook do provedor pra nossa URL
		const publicApiUrl = process.env.PUBLIC_API_URL ?? 'http://localhost:3333';
		const webhookUrl = `${publicApiUrl}/api/omni/webhook/${instance.id}/${instance.webhook_secret}`;
		await provider.configureWebhook(buildProviderCtx(instance), webhookUrl);

		// 3) conecta (QR nos não-oficiais; Meta valida credenciais)
		const result = await provider.connect(buildProviderCtx(instance));
		await omniInstanceRepository.setStatus(id, {
			status:
				result.status === 'connected'
					? 'connected'
					: result.qrCodeBase64
						? 'qr'
						: 'connecting',
			setup_status:
				result.status === 'connected'
					? 'ready'
					: result.qrCodeBase64
						? 'qr'
						: 'provider_created',
			qr_code: result.qrCodeBase64 ?? null,
			setup_error: null,
		});
		return reply.send({
			qrCodeBase64: result.qrCodeBase64,
			qr_code: result.qrCodeBase64,
			status: result.status,
			webhook_url: webhookUrl,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		await omniInstanceRepository.setStatus(id, {
			status: 'error',
			setup_status: 'error',
			setup_error: message.slice(0, 500),
		});
		return reply.status(502).send({ message });
	}
}

export async function instanceStatusController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as IdParams;
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	try {
		const provider = getProvider(instance.provider);
		const status = await provider.getStatus(buildProviderCtx(instance));
		if (status.connected && instance.status !== 'connected') {
			await omniInstanceRepository.setStatus(id, {
				status: 'connected',
				setup_status: 'ready',
				phone_number: status.phoneNumber ?? instance.phone_number,
				profile_name: status.profileName ?? instance.profile_name,
				qr_code: null,
			});
		} else if (!status.connected && instance.status === 'connected') {
			await omniInstanceRepository.setStatus(id, { status: 'disconnected' });
		}
		const fresh = await omniInstanceRepository.findById(id);
		return reply.send({
			status: status.connected
				? 'connected'
				: (fresh?.status ?? 'disconnected'),
			phone_number: status.phoneNumber ?? fresh?.phone_number ?? null,
			profile_name: status.profileName ?? fresh?.profile_name ?? null,
			qr_code: fresh?.qr_code ?? null,
			billing_status: fresh?.billing_status ?? 'ok',
			webhook_url: `${process.env.PUBLIC_API_URL ?? 'http://localhost:3333'}/api/omni/webhook/${id}/${instance.webhook_secret}`,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(502).send({ message });
	}
}

export async function disconnectInstanceController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as IdParams;
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	try {
		const provider = getProvider(instance.provider);
		await provider.disconnect?.(buildProviderCtx(instance));
	} catch {
		// best-effort
	}
	await omniInstanceRepository.setStatus(id, {
		status: 'disconnected',
		qr_code: null,
	});
	return reply.send({ ok: true });
}

export async function instanceStatsController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as IdParams;
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	const stats = await omniChatRepository.stats(id);
	return reply.send(stats);
}
