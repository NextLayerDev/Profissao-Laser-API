import { resolveMetaMediaUrl } from '../../lib/omni/providers/index.js';
import { emitOmni } from '../../lib/omni/socket.js';
import { uploadOmniMedia } from '../../lib/storage.js';
import { omniChatRepository } from '../../repositories/omni-chat.js';
import { omniInstanceRepository } from '../../repositories/omni-instance.js';
import { omniMessageRepository } from '../../repositories/omni-message.js';
import type {
	OmniChat,
	OmniInstance,
	OmniMessage,
	OmniWebhookEvent,
} from '../../types/omni.js';
import { omniDebounce } from './debounce.js';

/**
 * Ingest do webhook do OmniResposta: evento normalizado → persistência →
 * realtime → agendamento do turno de IA. O webhook ACKa antes (setImmediate);
 * aqui NUNCA lança pra fora (loga e segue — perder 1 evento é melhor que
 * derrubar o batch inteiro).
 */

const MAX_INBOUND_MEDIA = 25 * 1024 * 1024;

function preview(ev: Extract<OmniWebhookEvent, { type: 'message' }>): string {
	if (ev.text) return ev.text;
	if (ev.caption) return ev.caption;
	switch (ev.kind) {
		case 'image':
			return '[imagem]';
		case 'audio':
			return '[áudio]';
		case 'video':
			return '[vídeo]';
		case 'document':
			return `[documento] ${ev.fileName ?? ''}`.trim();
		case 'sticker':
			return '[figurinha]';
		default:
			return '[mensagem]';
	}
}

function shouldQueueForAi(
	instance: OmniInstance,
	chat: OmniChat,
	ev: Extract<OmniWebhookEvent, { type: 'message' }>,
): boolean {
	return (
		instance.ia_enabled &&
		instance.billing_status === 'ok' &&
		!chat.ia_paused &&
		chat.assigned_to === 'ai' &&
		!ev.fromMe &&
		ev.kind !== 'unsupported'
	);
}

/** Re-hospeda a mídia inbound no Bunny (URLs de provedor expiram). */
async function rehostMedia(
	instance: OmniInstance,
	msg: OmniMessage,
	ev: Extract<OmniWebhookEvent, { type: 'message' }>,
): Promise<void> {
	try {
		let buffer: Buffer | null = null;
		let mime = ev.mimeType ?? 'application/octet-stream';
		if (ev.mediaBase64) {
			buffer = Buffer.from(ev.mediaBase64, 'base64');
		} else {
			let url = ev.mediaUrl ?? null;
			const headers: Record<string, string> = {};
			if (!url && ev.mediaProviderId && instance.provider === 'meta') {
				const { buildProviderCtx } = await import(
					'../../lib/omni/providers/index.js'
				);
				const ctx = buildProviderCtx(instance);
				const resolved = await resolveMetaMediaUrl(
					ev.mediaProviderId,
					ctx.meta?.wabaToken ?? '',
				);
				if (resolved) {
					url = resolved.url;
					mime = resolved.mime;
					headers.Authorization = `Bearer ${ctx.meta?.wabaToken ?? ''}`;
				}
			}
			if (!url) return;
			const res = await fetch(url, {
				headers,
				signal: AbortSignal.timeout(30_000),
			});
			if (!res.ok) return;
			const buf = Buffer.from(await res.arrayBuffer());
			if (buf.length === 0 || buf.length > MAX_INBOUND_MEDIA) return;
			buffer = buf;
			mime = res.headers.get('content-type') ?? mime;
		}
		if (!buffer || buffer.length > MAX_INBOUND_MEDIA) return;
		const name = ev.fileName ?? `${ev.kind}.${mime.split('/')[1] ?? 'bin'}`;
		const url = await uploadOmniMedia(instance.id, buffer, name, mime);
		await omniMessageRepository.setMediaUrl(msg.id, url);
		msg.media_url = url;
	} catch (err) {
		console.error('[omni-inbox] re-hospedar mídia falhou:', err);
	}
}

async function ingestMessage(
	instance: OmniInstance,
	ev: Extract<OmniWebhookEvent, { type: 'message' }>,
): Promise<void> {
	if (ev.isGroup || ev.waChatId === 'status@broadcast') return;

	const contact = await omniChatRepository.upsertContact(
		instance.id,
		ev.senderWaId,
		{ push_name: ev.senderName ?? null },
	);
	const chat = await omniChatRepository.upsertChat(
		instance.id,
		contact.id,
		ev.waChatId,
	);

	const queueAi = shouldQueueForAi(instance, chat, ev);
	const msg = await omniMessageRepository.insertInbound({
		chat_id: chat.id,
		instance_id: instance.id,
		provider_message_id: ev.providerMessageId,
		direction: ev.fromMe ? 'out' : 'in',
		author_type: ev.fromMe ? 'user' : 'contact',
		sender_name: ev.senderName ?? null,
		sender_wa_id: ev.senderWaId,
		content: ev.text ?? null,
		media_type:
			ev.kind === 'text' || ev.kind === 'unsupported' ? null : ev.kind,
		file_name: ev.fileName ?? null,
		caption: ev.caption ?? null,
		quoted: ev.quoted ?? null,
		status: ev.fromMe ? 'sent' : 'delivered',
		ai_state: queueAi ? 'pending' : null,
		wa_timestamp: ev.timestamp.toISOString(),
	});
	if (msg == null) return; // duplicada (retry de webhook)

	if (ev.mediaBase64 || ev.mediaUrl || ev.mediaProviderId) {
		await rehostMedia(instance, msg, ev);
	}

	if (!ev.fromMe) {
		await omniChatRepository.bumpInbound(chat.id, preview(ev));
	} else {
		await omniChatRepository.bumpOutbound(chat.id, preview(ev));
	}

	emitOmni(instance.id, 'new-message', { chatId: chat.id, message: msg });
	const fresh = await omniChatRepository.findById(chat.id);
	if (fresh) emitOmni(instance.id, 'chat-update', { chat: fresh });

	if (msg.ai_state === 'pending') {
		omniDebounce.schedule(instance, chat.id);
	}
}

class OmniInboxService {
	async ingestBatch(
		instance: OmniInstance,
		events: OmniWebhookEvent[],
	): Promise<void> {
		for (const ev of events) {
			try {
				await this.ingest(instance, ev);
			} catch (err) {
				console.error('[omni-inbox] evento falhou:', err);
			}
		}
	}

	async ingest(instance: OmniInstance, ev: OmniWebhookEvent): Promise<void> {
		if (ev.type === 'connection') {
			await omniInstanceRepository.setStatus(instance.id, {
				status:
					ev.status === 'connected'
						? 'connected'
						: ev.status === 'qr'
							? 'qr'
							: 'disconnected',
				...(ev.qrCodeBase64 ? { qr_code: ev.qrCodeBase64 } : {}),
				...(ev.status === 'connected'
					? { setup_status: 'ready', qr_code: null }
					: {}),
			});
			emitOmni(instance.id, 'instance-status', {
				status: ev.status,
				qr_code: ev.qrCodeBase64 ?? null,
			});
			return;
		}
		if (ev.type === 'status') {
			const chatId = await omniMessageRepository.updateStatusByProviderId(
				instance.id,
				ev.providerMessageId,
				ev.status,
			);
			if (chatId) {
				emitOmni(instance.id, 'messages-read', {
					chatId,
					providerMessageIds: [ev.providerMessageId],
					status: ev.status,
				});
			}
			return;
		}
		await ingestMessage(instance, ev);
	}
}

export const omniInboxService = new OmniInboxService();
