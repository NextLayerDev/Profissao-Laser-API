import type { OmniWebhookEvent } from '../../../types/omni.js';
import type { OmniProvider, ProviderCtx, SendMediaInput } from './types.js';

/**
 * Adapter Z-API (port do zapi-client/zapi-developer-client do system_porteira).
 * Base: https://api.z-api.io/instances/{id}/token/{token}; header `Client-Token`
 * = token de segurança DA CONTA (env ZAPI_SECURITY_TOKEN). Criação programática
 * de instância via partner API `/instances/integrator/on-demand`.
 */

const ZAPI_BASE = 'https://api.z-api.io';

function accountToken(): string {
	return process.env.ZAPI_SECURITY_TOKEN || process.env.ZAPI_CLIENT_TOKEN || '';
}

function instanceUrl(ctx: ProviderCtx, path: string): string {
	const z = ctx.zapi;
	if (!z) throw new Error('instância sem credenciais Z-API');
	return `${ZAPI_BASE}/instances/${z.instanceId}/token/${z.instanceToken}${path}`;
}

function headers(): Record<string, string> {
	return {
		'content-type': 'application/json',
		'Client-Token': accountToken(),
	};
}

async function zfetch(
	url: string,
	init?: RequestInit,
): Promise<Record<string, unknown>> {
	const res = await fetch(url, {
		headers: headers(),
		signal: AbortSignal.timeout(30_000),
		...init,
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Z-API ${res.status}: ${body.slice(0, 300)}`);
	}
	return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/** Número puro (Z-API não usa sufixo @s.whatsapp.net). */
const phoneOf = (waId: string) => waId.split('@')[0];

function normalizeTimestamp(raw: unknown): Date {
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return new Date();
	// segundos vs milissegundos
	return new Date(n < 10_000_000_000 ? n * 1000 : n);
}

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null =>
	v && typeof v === 'object' ? (v as Obj) : null;
const str = (v: unknown): string | undefined =>
	typeof v === 'string' && v.length > 0 ? v : undefined;

/** Extrai o evento de MENSAGEM do payload plano da Z-API (ReceivedCallback). */
function parseMessage(d: Obj): OmniWebhookEvent | null {
	const providerMessageId = str(d.messageId) ?? str(d.id);
	const phone = str(d.phone);
	if (!providerMessageId || !phone) return null;

	const isGroup =
		d.isGroup === true || phone.includes('-group') || phone.endsWith('@g.us');
	const waChatId = phone;
	const fromMe = d.fromMe === true;
	const senderName = str(d.senderName) ?? str(d.pushName) ?? str(d.chatName);
	const timestamp = normalizeTimestamp(d.momment ?? d.moment ?? d.timestamp);

	const base = {
		type: 'message' as const,
		providerMessageId,
		waChatId,
		fromMe,
		isGroup,
		senderWaId: phone,
		senderName,
		timestamp,
	};

	const text = asObj(d.text);
	if (text && str(text.message)) {
		return { ...base, kind: 'text', text: str(text.message) };
	}
	if (str(d.text)) return { ...base, kind: 'text', text: str(d.text) };
	if (str(d.message)) return { ...base, kind: 'text', text: str(d.message) };
	if (str(d.body)) return { ...base, kind: 'text', text: str(d.body) };

	const image = asObj(d.image);
	if (image) {
		return {
			...base,
			kind: 'image',
			mediaUrl: str(image.imageUrl) ?? str(image.url),
			mimeType: str(image.mimeType) ?? 'image/jpeg',
			caption: str(image.caption),
		};
	}
	const audio = asObj(d.audio);
	if (audio) {
		return {
			...base,
			kind: 'audio',
			mediaUrl: str(audio.audioUrl) ?? str(audio.url),
			mimeType: str(audio.mimeType) ?? 'audio/ogg',
		};
	}
	const video = asObj(d.video);
	if (video) {
		return {
			...base,
			kind: 'video',
			mediaUrl: str(video.videoUrl) ?? str(video.url),
			mimeType: str(video.mimeType) ?? 'video/mp4',
			caption: str(video.caption),
		};
	}
	const document = asObj(d.document);
	if (document) {
		return {
			...base,
			kind: 'document',
			mediaUrl: str(document.documentUrl) ?? str(document.url),
			mimeType: str(document.mimeType) ?? 'application/octet-stream',
			fileName: str(document.fileName),
			caption: str(document.caption),
		};
	}
	const sticker = asObj(d.sticker);
	if (sticker) {
		return {
			...base,
			kind: 'sticker',
			mediaUrl: str(sticker.stickerUrl) ?? str(sticker.url),
			mimeType: 'image/webp',
		};
	}
	return { ...base, kind: 'unsupported' };
}

function normalizeStatus(s: string): 'sent' | 'delivered' | 'read' | null {
	const up = s.toUpperCase();
	if (up === 'SENT' || up === 'SERVER_ACK') return 'sent';
	if (up === 'RECEIVED' || up === 'DELIVERED' || up === 'DELIVERY_ACK') {
		return 'delivered';
	}
	if (up === 'READ' || up === 'READ-SELF' || up === 'VIEWED') return 'read';
	return null;
}

export const zapiProvider: OmniProvider = {
	kind: 'zapi',

	async createRemoteInstance(name: string) {
		const res = await fetch(`${ZAPI_BASE}/instances/integrator/on-demand`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'Client-Token': accountToken(),
				Authorization: `Bearer ${accountToken()}`,
			},
			body: JSON.stringify({ name }),
			signal: AbortSignal.timeout(30_000),
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(
				`Z-API criar instância falhou (${res.status}): ${body.slice(0, 300)}`,
			);
		}
		const data = (await res.json()) as { id?: string; token?: string };
		if (!data.id || !data.token) {
			throw new Error('Z-API criar instância: resposta sem id/token');
		}
		return { zapiInstanceId: data.id, zapiToken: data.token };
	},

	async connect(ctx) {
		const data = await zfetch(instanceUrl(ctx, '/qr-code/image'));
		const qr = str(data.value) ?? str(data.qrCode) ?? str(data.qrcode) ?? null;
		return { qrCodeBase64: qr, status: qr ? 'qr' : 'connecting' };
	},

	async getStatus(ctx) {
		const data = await zfetch(instanceUrl(ctx, '/status'));
		return {
			connected: data.connected === true,
			phoneNumber: str(data.phoneNumber) ?? str(data.phone) ?? null,
			profileName: str(data.profileName) ?? str(data.name) ?? null,
			qrCodeBase64: null,
		};
	},

	async disconnect(ctx) {
		await zfetch(instanceUrl(ctx, '/disconnect')).catch(() => ({}));
	},

	async configureWebhook(ctx, url) {
		// Endpoints oficiais de update por evento (mesma URL pra todos).
		const targets = [
			'/update-webhook-received',
			'/update-webhook-connected',
			'/update-webhook-disconnected',
			'/update-webhook-message-status',
		];
		for (const t of targets) {
			await zfetch(instanceUrl(ctx, t), {
				method: 'PUT',
				body: JSON.stringify({ value: url }),
			}).catch(async () => {
				// fallback antigo: POST /webhook
				await zfetch(instanceUrl(ctx, '/webhook'), {
					method: 'POST',
					body: JSON.stringify({ webhook: url, webhookByEvents: false }),
				}).catch(() => ({}));
			});
		}
	},

	async sendText(ctx, toWaId, text) {
		const data = await zfetch(instanceUrl(ctx, '/send-text'), {
			method: 'POST',
			body: JSON.stringify({ phone: phoneOf(toWaId), message: text }),
		});
		return {
			providerMessageId: str(data.messageId) ?? str(data.id) ?? null,
		};
	},

	async sendMedia(ctx, toWaId, media: SendMediaInput) {
		const value = media.isBase64
			? `data:${media.mime};base64,${media.urlOrBase64}`
			: media.urlOrBase64;
		const phone = phoneOf(toWaId);
		let endpoint: string;
		const body: Record<string, unknown> = { phone };
		switch (media.kind) {
			case 'image':
				endpoint = '/send-image';
				body.image = value;
				break;
			case 'video':
				endpoint = '/send-video';
				body.video = value;
				break;
			case 'audio':
				endpoint = '/send-audio';
				body.audio = value;
				break;
			default:
				endpoint = '/send-document';
				body.document = value;
				body.fileName = media.fileName || 'documento';
		}
		if (media.caption && media.kind !== 'audio') body.caption = media.caption;
		const data = await zfetch(instanceUrl(ctx, endpoint), {
			method: 'POST',
			body: JSON.stringify(body),
		});
		return {
			providerMessageId: str(data.messageId) ?? str(data.id) ?? null,
		};
	},

	async markRead(ctx, waChatId, providerMessageId) {
		await zfetch(instanceUrl(ctx, '/read-message'), {
			method: 'POST',
			body: JSON.stringify({
				phone: phoneOf(waChatId),
				messageId: providerMessageId,
			}),
		}).catch(() => ({}));
	},

	parseWebhook(body): OmniWebhookEvent[] {
		const d = asObj(body);
		if (!d) return [];
		const type = str(d.type) ?? '';

		// Conexão
		if (type === 'ConnectedCallback' || d.connected === true) {
			if (type === 'ConnectedCallback') {
				return [{ type: 'connection', status: 'connected' }];
			}
		}
		if (type === 'DisconnectedCallback') {
			return [{ type: 'connection', status: 'disconnected' }];
		}

		// Status de mensagem (MessageStatusCallback: {status, ids:[...]})
		if (type.toLowerCase().includes('status') || Array.isArray(d.ids)) {
			const status = normalizeStatus(str(d.status) ?? '');
			if (!status) return [];
			const ids = Array.isArray(d.ids)
				? (d.ids.filter((x) => typeof x === 'string') as string[])
				: str(d.messageId)
					? [str(d.messageId) as string]
					: [];
			return ids.map((id) => ({
				type: 'status',
				providerMessageId: id,
				status,
			}));
		}

		// broadcast/status do WhatsApp
		if (str(d.phone) === 'status@broadcast') return [];

		const msg = parseMessage(d);
		return msg ? [msg] : [];
	},
};
