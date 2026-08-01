import type { FastifyReply, FastifyRequest } from 'fastify';
import { isAdminRole } from '../../lib/external-auth.js';
import { omniChatRepository } from '../../repositories/omni-chat.js';
import { omniInstanceRepository } from '../../repositories/omni-instance.js';
import type { OmniChat, OmniInstance } from '../../types/omni.js';

/**
 * Ownership do OmniResposta: cada instância pertence a um expert (owner_id =
 * id upvox). Admin acessa qualquer uma; staff só as suas. Devolve null e já
 * responde 404/403 quando não pode.
 */
export async function resolveInstanceAccess(
	request: FastifyRequest,
	reply: FastifyReply,
	instanceId: string,
): Promise<OmniInstance | null> {
	const instance = await omniInstanceRepository.findById(instanceId);
	if (!instance || !instance.is_active) {
		reply.status(404).send({ message: 'Instância não encontrada' });
		return null;
	}
	const user = request.currentUser;
	if (!user) {
		reply.status(401).send({ message: 'Not authenticated' });
		return null;
	}
	if (!isAdminRole(request.currentRole) && instance.owner_id !== user.id) {
		reply.status(403).send({ message: 'Sem acesso a esta instância' });
		return null;
	}
	return instance;
}

/** Idem, partindo de um chat. Devolve {chat, instance} ou null (já respondeu). */
export async function resolveChatAccess(
	request: FastifyRequest,
	reply: FastifyReply,
	chatId: string,
): Promise<{ chat: OmniChat; instance: OmniInstance } | null> {
	const chat = await omniChatRepository.findById(chatId);
	if (!chat) {
		reply.status(404).send({ message: 'Chat não encontrado' });
		return null;
	}
	const instance = await resolveInstanceAccess(
		request,
		reply,
		chat.instance_id,
	);
	if (!instance) return null;
	return { chat, instance };
}

/** Projeção segura da instância pro front (sem tokens/secret). */
export function sanitizeInstance(
	instance: OmniInstance,
): Record<string, unknown> {
	const publicApiUrl = process.env.PUBLIC_API_URL ?? 'http://localhost:3333';
	const {
		zapi_instance_token: _zt,
		meta_waba_token: _mt,
		meta_app_secret: _ms,
		webhook_secret: _ws,
		...safe
	} = instance;
	return {
		...safe,
		has_zapi_token: !!instance.zapi_instance_token,
		has_meta_token: !!instance.meta_waba_token,
		webhook_url: `${publicApiUrl}/api/omni/webhook/${instance.id}/${instance.webhook_secret}`,
	};
}
