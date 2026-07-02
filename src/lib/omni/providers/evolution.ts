import type { OmniWebhookEvent } from '../../../types/omni.js';
import type { OmniProvider, ProviderCtx, SendMediaInput } from './types.js';

/**
 * Adapter Evolution API (self-hosted; port do evolution-api.ts do porteira).
 * Envs: EVOLUTION_API_BASE_URL + EVOLUTION_API_KEY (header `apikey`). Cada
 * instância nossa vira uma instância Evolution (instanceName salvo na row).
 * Webhook com base64 LIGADO: mídia chega inline no payload (as URLs do
 * WhatsApp são criptografadas — o base64 é o caminho prático).
 */

function baseUrl(): string {
	const url = process.env.EVOLUTION_API_BASE_URL;
	if (!url) throw new Error('EVOLUTION_API_BASE_URL não configurada');
	return url.replace(/\/$/, '');
}

function headers(): Record<string, string> {
	return {
		'content-type': 'application/json',
		apikey: process.env.EVOLUTION_API_KEY ?? '',
	};
}

async function efetch(
	path: string,
	init?: RequestInit,
): Promise<Record<string, unknown>> {
	const res = await fetch(`${baseUrl()}${path}`, {
		headers: headers(),
		signal: AbortSignal.timeout(30_000),
		...init,
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Evolution ${res.status}: ${body.slice(0, 300)}`);
	}
	return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

const instName = (ctx: ProviderCtx): string => {
	const name = ctx.evolution?.instanceName;
	if (!name) throw new Error('instância sem instanceName Evolution');
	return name;
};

const phoneOf = (waId: string) => waId.split('@')[0];

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null =>
	v && typeof v === 'object' ? (v as Obj) : null;
const str = (v: unknown): string | undefined =>
	typeof v === 'string' && v.length > 0 ? v : undefined;

function normalizeStatus(s: string): 'sent' | 'delivered' | 'read' | null {
	const up = s.toUpperCase();
	if (up === 'SERVER_ACK' || up === 'SENT' || up === 'PENDING') return 'sent';
	if (up === 'DELIVERY_ACK' || up === 'DELIVERED') return 'delivered';
	if (up === 'READ' || up === 'PLAYED') return 'read';
	return null;
}

function parseUpsert(data: Obj): OmniWebhookEvent | null {
	const key = asObj(data.key);
	const providerMessageId = str(key?.id);
	const remoteJid = str(key?.remoteJid);
	if (!providerMessageId || !remoteJid) return null;

	const isGroup =
		remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast');
	const fromMe = key?.fromMe === true;
	const senderName = str(data.pushName);
	const tsRaw = Number(data.messageTimestamp);
	const timestamp =
		Number.isFinite(tsRaw) && tsRaw > 0
			? new Date(tsRaw < 10_000_000_000 ? tsRaw * 1000 : tsRaw)
			: new Date();

	const base = {
		type: 'message' as const,
		providerMessageId,
		waChatId: remoteJid,
		fromMe,
		isGroup,
		senderWaId: remoteJid,
		senderName,
		timestamp,
	};

	const message = asObj(data.message);
	if (!message) return { ...base, kind: 'unsupported' };
	// webhookBase64=true → o base64 da mídia vem no próprio message
	const mediaBase64 = str(message.base64);

	const conversation = str(message.conversation);
	if (conversation) return { ...base, kind: 'text', text: conversation };
	const ext = asObj(message.extendedTextMessage);
	if (ext && str(ext.text))
		return { ...base, kind: 'text', text: str(ext.text) };

	const image = asObj(message.imageMessage);
	if (image) {
		return {
			...base,
			kind: 'image',
			mediaBase64,
			mediaUrl: mediaBase64 ? undefined : str(image.url),
			mimeType: str(image.mimetype) ?? 'image/jpeg',
			caption: str(image.caption),
		};
	}
	const audio = asObj(message.audioMessage);
	if (audio) {
		return {
			...base,
			kind: 'audio',
			mediaBase64,
			mediaUrl: mediaBase64 ? undefined : str(audio.url),
			mimeType: str(audio.mimetype) ?? 'audio/ogg',
		};
	}
	const video = asObj(message.videoMessage);
	if (video) {
		return {
			...base,
			kind: 'video',
			mediaBase64,
			mediaUrl: mediaBase64 ? undefined : str(video.url),
			mimeType: str(video.mimetype) ?? 'video/mp4',
			caption: str(video.caption),
		};
	}
	const doc = asObj(message.documentMessage);
	if (doc) {
		return {
			...base,
			kind: 'document',
			mediaBase64,
			mediaUrl: mediaBase64 ? undefined : str(doc.url),
			mimeType: str(doc.mimetype) ?? 'application/octet-stream',
			fileName: str(doc.fileName),
			caption: str(doc.caption),
		};
	}
	if (asObj(message.stickerMessage)) {
		return { ...base, kind: 'sticker', mediaBase64, mimeType: 'image/webp' };
	}
	return { ...base, kind: 'unsupported' };
}

export const evolutionProvider: OmniProvider = {
	kind: 'evolution',

	async createRemoteInstance(name: string) {
		const instanceName = `${name}_${Date.now()}`
			.toLowerCase()
			.replace(/[^a-z0-9_-]/g, '');
		await efetch('/instance/create', {
			method: 'POST',
			body: JSON.stringify({
				instanceName,
				qrcode: true,
				integration: 'WHATSAPP-BAILEYS',
			}),
		});
		return { evolutionInstance: instanceName };
	},

	async connect(ctx) {
		const data = await efetch(`/instance/connect/${instName(ctx)}`);
		// resposta: { base64?: 'data:image/png;base64,...', code?, pairingCode? }
		const qr =
			str(data.base64) ??
			str(asObj(data.qrcode)?.base64) ??
			str(data.code) ??
			null;
		return { qrCodeBase64: qr, status: qr ? 'qr' : 'connecting' };
	},

	async getStatus(ctx) {
		const data = await efetch(`/instance/connectionState/${instName(ctx)}`);
		const inst = asObj(data.instance) ?? data;
		const state = str(inst.state) ?? str(data.state) ?? '';
		return {
			connected: state === 'open',
			phoneNumber: str(inst.owner)?.split('@')[0] ?? null,
			profileName: str(inst.profileName) ?? null,
			qrCodeBase64: null,
		};
	},

	async disconnect(ctx) {
		await efetch(`/instance/logout/${instName(ctx)}`, {
			method: 'DELETE',
		}).catch(() => ({}));
	},

	async configureWebhook(ctx, url) {
		await efetch(`/webhook/set/${instName(ctx)}`, {
			method: 'POST',
			body: JSON.stringify({
				webhook: {
					url,
					enabled: true,
					webhookByEvents: false,
					webhookBase64: true,
					events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
				},
			}),
		});
	},

	async sendText(ctx, toWaId, text) {
		const data = await efetch(`/message/sendText/${instName(ctx)}`, {
			method: 'POST',
			body: JSON.stringify({ number: phoneOf(toWaId), text }),
		});
		const key = asObj(data.key);
		return { providerMessageId: str(key?.id) ?? null };
	},

	async sendMedia(ctx, toWaId, media: SendMediaInput) {
		if (media.kind === 'audio') {
			const data = await efetch(`/message/sendWhatsAppAudio/${instName(ctx)}`, {
				method: 'POST',
				body: JSON.stringify({
					number: phoneOf(toWaId),
					audio: media.urlOrBase64, // Evolution aceita URL ou base64
				}),
			});
			return { providerMessageId: str(asObj(data.key)?.id) ?? null };
		}
		const data = await efetch(`/message/sendMedia/${instName(ctx)}`, {
			method: 'POST',
			body: JSON.stringify({
				number: phoneOf(toWaId),
				mediatype: media.kind,
				mimetype: media.mime,
				media: media.urlOrBase64,
				caption: media.caption,
				fileName: media.fileName,
			}),
		});
		return { providerMessageId: str(asObj(data.key)?.id) ?? null };
	},

	async markRead(ctx, waChatId, providerMessageId) {
		await efetch(`/chat/markMessageAsRead/${instName(ctx)}`, {
			method: 'POST',
			body: JSON.stringify({
				readMessages: [
					{ remoteJid: waChatId, fromMe: false, id: providerMessageId },
				],
			}),
		}).catch(() => ({}));
	},

	parseWebhook(body): OmniWebhookEvent[] {
		const d = asObj(body);
		if (!d) return [];
		const event = (str(d.event) ?? '').toLowerCase();
		const data = asObj(d.data);

		if (event === 'connection.update') {
			const state = str(data?.state) ?? '';
			if (state === 'open')
				return [{ type: 'connection', status: 'connected' }];
			if (state === 'close') {
				return [{ type: 'connection', status: 'disconnected' }];
			}
			return [];
		}
		if (event === 'qrcode.updated') {
			const qr = str(asObj(data?.qrcode)?.base64);
			return [{ type: 'connection', status: 'qr', qrCodeBase64: qr }];
		}
		if (event === 'messages.update') {
			// data pode ser objeto único ou array
			const rows = Array.isArray(d.data) ? d.data : [data];
			const out: OmniWebhookEvent[] = [];
			for (const raw of rows) {
				const r = asObj(raw);
				if (!r) continue;
				const id = str(r.keyId) ?? str(asObj(r.key)?.id) ?? str(r.messageId);
				const status = normalizeStatus(str(r.status) ?? '');
				if (id && status) {
					out.push({ type: 'status', providerMessageId: id, status });
				}
			}
			return out;
		}
		if (event === 'messages.upsert') {
			// data único OU data.messages[]
			const rows = Array.isArray(asObj(d.data)?.messages)
				? ((asObj(d.data)?.messages ?? []) as unknown[])
				: [data];
			const out: OmniWebhookEvent[] = [];
			for (const raw of rows) {
				const r = asObj(raw);
				if (!r) continue;
				const msg = parseUpsert(r);
				if (msg) out.push(msg);
			}
			return out;
		}
		return [];
	},
};
