import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	buildProviderCtx,
	getProvider,
} from '../../lib/omni/providers/index.js';
import { emitOmni } from '../../lib/omni/socket.js';
import { uploadOmniMedia } from '../../lib/storage.js';
import { omniChatRepository } from '../../repositories/omni-chat.js';
import { omniMessageRepository } from '../../repositories/omni-message.js';
import { resolveChatAccess, resolveInstanceAccess } from './access.js';

const MAX_SEND_MEDIA = 16 * 1024 * 1024;

export async function listChatsController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as { id: string };
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	const q = request.query as Record<string, string | undefined>;
	const chats = await omniChatRepository.listChats(id, {
		search: q.search,
		filter: (q.filter as 'all' | 'ia' | 'human') ?? 'all',
		leadStep: q.leadStep,
		archived: q.archived === 'true',
		pinned: q.pinned === 'true' ? true : undefined,
		limit: q.limit ? Number(q.limit) : 30,
		cursor: q.cursor,
	});
	const nextCursor =
		chats.length > 0 ? chats[chats.length - 1].last_message_at : null;
	return reply.send({ chats, nextCursor });
}

export async function listMessagesController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { chatId } = request.params as { chatId: string };
	const access = await resolveChatAccess(request, reply, chatId);
	if (!access) return;
	const q = request.query as { before?: string; limit?: string };
	const messages = await omniMessageRepository.listByChat(chatId, {
		before: q.before,
		limit: q.limit ? Number(q.limit) : 50,
	});
	return reply.send(messages);
}

/** Envio como HUMANO (atendente). JSON {text} ou multipart (file + caption). */
export async function sendMessageController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { chatId } = request.params as { chatId: string };
	const access = await resolveChatAccess(request, reply, chatId);
	if (!access) return;
	const { chat, instance } = access;
	const user = request.currentUser;
	const provider = getProvider(instance.provider);
	const ctx = buildProviderCtx(instance);

	let text: string | null = null;
	let file: { buffer: Buffer; mime: string; name: string } | null = null;
	let caption: string | undefined;

	if (request.isMultipart()) {
		for await (const part of request.parts()) {
			if (part.type === 'file') {
				const buffer = await part.toBuffer();
				file = {
					buffer,
					mime: part.mimetype,
					name: part.filename ?? 'arquivo',
				};
			} else if (part.fieldname === 'caption') {
				caption = String(part.value ?? '');
			} else if (part.fieldname === 'text') {
				text = String(part.value ?? '');
			}
		}
	} else {
		const body = (request.body ?? {}) as { text?: string };
		text = body.text?.trim() || null;
	}

	try {
		let providerMessageId: string | null = null;
		let mediaUrl: string | null = null;
		let mediaType: 'image' | 'audio' | 'video' | 'document' | null = null;
		if (file) {
			if (file.buffer.length > MAX_SEND_MEDIA) {
				return reply
					.status(400)
					.send({ message: 'Arquivo acima de 16MB não é suportado.' });
			}
			mediaType = file.mime.startsWith('image/')
				? 'image'
				: file.mime.startsWith('audio/')
					? 'audio'
					: file.mime.startsWith('video/')
						? 'video'
						: 'document';
			// re-hospeda ANTES (Meta exige URL pública; e a UI mostra do Bunny)
			mediaUrl = await uploadOmniMedia(
				instance.id,
				file.buffer,
				file.name,
				file.mime,
			);
			const sent = await provider.sendMedia(ctx, chat.wa_chat_id, {
				kind: mediaType,
				urlOrBase64:
					instance.provider === 'meta'
						? mediaUrl
						: file.buffer.toString('base64'),
				isBase64: instance.provider !== 'meta',
				mime: file.mime,
				fileName: file.name,
				caption,
			});
			providerMessageId = sent.providerMessageId;
		} else if (text) {
			const sent = await provider.sendText(ctx, chat.wa_chat_id, text);
			providerMessageId = sent.providerMessageId;
		} else {
			return reply.status(400).send({ message: 'Envie text ou um arquivo.' });
		}

		const msg = await omniMessageRepository.insertOutbound({
			chat_id: chat.id,
			instance_id: instance.id,
			provider_message_id: providerMessageId,
			direction: 'out',
			author_type: 'user',
			author_id: user?.id ?? null,
			sender_name: user?.name ?? user?.email ?? 'Atendente',
			content: text,
			media_url: mediaUrl,
			media_type: mediaType,
			file_name: file?.name ?? null,
			caption: caption ?? null,
			status: 'sent',
			wa_timestamp: new Date().toISOString(),
		});
		await omniChatRepository.bumpOutbound(
			chat.id,
			text ?? caption ?? `[${mediaType ?? 'arquivo'}]`,
		);
		emitOmni(instance.id, 'new-message', { chatId: chat.id, message: msg });
		const fresh = await omniChatRepository.findById(chat.id);
		if (fresh) emitOmni(instance.id, 'chat-update', { chat: fresh });
		return reply.status(201).send(msg);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(502).send({ message });
	}
}

export async function markReadController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { chatId } = request.params as { chatId: string };
	const access = await resolveChatAccess(request, reply, chatId);
	if (!access) return;
	const { chat, instance } = access;
	await omniChatRepository.resetUnread(chatId);
	// best-effort no provedor
	try {
		const last = await omniMessageRepository.lastInbound(chatId);
		if (last?.provider_message_id) {
			const provider = getProvider(instance.provider);
			await provider.markRead?.(
				buildProviderCtx(instance),
				chat.wa_chat_id,
				last.provider_message_id,
			);
		}
	} catch {
		// visual apenas
	}
	const fresh = await omniChatRepository.findById(chatId);
	if (fresh) emitOmni(instance.id, 'chat-update', { chat: fresh });
	return reply.send({ ok: true });
}

export async function updateChatController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { chatId } = request.params as { chatId: string };
	const access = await resolveChatAccess(request, reply, chatId);
	if (!access) return;
	const body = (request.body ?? {}) as {
		is_pinned?: boolean;
		is_archived?: boolean;
		lead_step?: string | null;
		ia_paused?: boolean;
		status?: 'active' | 'waiting' | 'closed';
	};
	const patch: Record<string, unknown> = {};
	if (typeof body.is_pinned === 'boolean') patch.is_pinned = body.is_pinned;
	if (typeof body.is_archived === 'boolean') {
		patch.is_archived = body.is_archived;
	}
	if (body.lead_step !== undefined) patch.lead_step = body.lead_step;
	if (typeof body.ia_paused === 'boolean') patch.ia_paused = body.ia_paused;
	if (body.status && ['active', 'waiting', 'closed'].includes(body.status)) {
		patch.status = body.status;
	}
	const updated = await omniChatRepository.updateChat(chatId, patch);
	emitOmni(access.instance.id, 'chat-update', { chat: updated });
	return reply.send(updated);
}

export async function transferChatController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { chatId } = request.params as { chatId: string };
	const access = await resolveChatAccess(request, reply, chatId);
	if (!access) return;
	const body = (request.body ?? {}) as {
		to?: 'ai' | 'user';
		userId?: string;
		userName?: string;
	};
	if (body.to === 'ai') {
		const updated = await omniChatRepository.updateChat(chatId, {
			assigned_to: 'ai',
			assigned_user_id: null,
			assigned_user_name: null,
			status: 'active',
		});
		emitOmni(access.instance.id, 'chat-update', { chat: updated });
		return reply.send(updated);
	}
	if (body.to === 'user') {
		const user = request.currentUser;
		const updated = await omniChatRepository.updateChat(chatId, {
			assigned_to: 'human',
			assigned_user_id: body.userId || (user?.id ?? null),
			assigned_user_name:
				body.userName || user?.name || user?.email || 'Atendente',
		});
		emitOmni(access.instance.id, 'chat-update', { chat: updated });
		return reply.send(updated);
	}
	return reply.status(400).send({ message: "to deve ser 'ai' ou 'user'" });
}

export async function transferAllController(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	const { id } = request.params as { id: string };
	const instance = await resolveInstanceAccess(request, reply, id);
	if (!instance) return;
	const count = await omniChatRepository.transferAll(id, 'ai');
	emitOmni(id, 'chat-update', { transferAll: true });
	return reply.send({ ok: true, transferred: count });
}
