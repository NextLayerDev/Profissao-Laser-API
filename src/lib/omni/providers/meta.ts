import type { OmniWebhookEvent } from '../../../types/omni.js';
import type { OmniProvider, ProviderCtx, SendMediaInput } from './types.js';

/**
 * Adapter Meta WhatsApp Cloud API (oficial). O expert cola as credenciais
 * (phone_number_id + token permanente do WABA + verify token do webhook); o
 * webhook é configurado no painel Meta apontando pra nossa URL (GET com
 * hub.challenge é respondido pelo controller). Mídia inbound vem como media id
 * → resolvida via Graph (URL expira ~5min; o inbox re-hospeda no Bunny).
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

function creds(ctx: ProviderCtx): { phoneNumberId: string; wabaToken: string } {
	if (!ctx.meta) throw new Error('instância sem credenciais Meta');
	return ctx.meta;
}

async function mfetch(
	url: string,
	token: string,
	init?: RequestInit,
): Promise<Record<string, unknown>> {
	const res = await fetch(url, {
		...init,
		headers: {
			'content-type': 'application/json',
			Authorization: `Bearer ${token}`,
			...(init?.headers ?? {}),
		},
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Meta ${res.status}: ${body.slice(0, 300)}`);
	}
	return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null =>
	v && typeof v === 'object' ? (v as Obj) : null;
const str = (v: unknown): string | undefined =>
	typeof v === 'string' && v.length > 0 ? v : undefined;

/** Resolve a URL temporária de um media id (o download exige o MESMO Bearer). */
export async function resolveMetaMediaUrl(
	mediaId: string,
	wabaToken: string,
): Promise<{ url: string; mime: string } | null> {
	try {
		const data = await mfetch(`${GRAPH}/${mediaId}`, wabaToken);
		const url = str(data.url);
		if (!url) return null;
		return { url, mime: str(data.mime_type) ?? 'application/octet-stream' };
	} catch {
		return null;
	}
}

function parseMessageEntry(
	m: Obj,
	contactName: string | undefined,
): OmniWebhookEvent | null {
	const providerMessageId = str(m.id);
	const from = str(m.from);
	if (!providerMessageId || !from) return null;
	const tsRaw = Number(m.timestamp);
	const base = {
		type: 'message' as const,
		providerMessageId,
		waChatId: from,
		fromMe: false,
		isGroup: false,
		senderWaId: from,
		senderName: contactName,
		timestamp:
			Number.isFinite(tsRaw) && tsRaw > 0 ? new Date(tsRaw * 1000) : new Date(),
	};
	const kind = str(m.type) ?? '';
	if (kind === 'text') {
		return { ...base, kind: 'text', text: str(asObj(m.text)?.body) };
	}
	if (kind === 'image' || kind === 'audio' || kind === 'video') {
		const media = asObj(m[kind]);
		return {
			...base,
			kind,
			mediaProviderId: str(media?.id),
			mimeType: str(media?.mime_type),
			caption: str(media?.caption),
		};
	}
	if (kind === 'document') {
		const doc = asObj(m.document);
		return {
			...base,
			kind: 'document',
			mediaProviderId: str(doc?.id),
			mimeType: str(doc?.mime_type),
			fileName: str(doc?.filename),
			caption: str(doc?.caption),
		};
	}
	if (kind === 'sticker') {
		return {
			...base,
			kind: 'sticker',
			mediaProviderId: str(asObj(m.sticker)?.id),
			mimeType: 'image/webp',
		};
	}
	return { ...base, kind: 'unsupported' };
}

export const metaProvider: OmniProvider = {
	kind: 'meta',

	// createRemoteInstance: n/a (credenciais coladas pelo expert)

	async connect(ctx) {
		// Sem QR: "conectar" = validar credenciais.
		const ok = await this.getStatus(ctx);
		return {
			qrCodeBase64: null,
			status: ok.connected ? 'connected' : 'error',
		};
	},

	async getStatus(ctx) {
		const { phoneNumberId, wabaToken } = creds(ctx);
		try {
			const data = await mfetch(
				`${GRAPH}/${phoneNumberId}?fields=display_phone_number,verified_name`,
				wabaToken,
			);
			return {
				connected: true,
				phoneNumber: str(data.display_phone_number) ?? null,
				profileName: str(data.verified_name) ?? null,
				qrCodeBase64: null,
			};
		} catch {
			return { connected: false, qrCodeBase64: null };
		}
	},

	async configureWebhook() {
		// No-op: o webhook da Meta é configurado no painel (App > WhatsApp >
		// Configuration) apontando pra nossa URL; o GET hub.challenge valida.
	},

	async sendText(ctx, toWaId, text) {
		const { phoneNumberId, wabaToken } = creds(ctx);
		const data = await mfetch(`${GRAPH}/${phoneNumberId}/messages`, wabaToken, {
			method: 'POST',
			body: JSON.stringify({
				messaging_product: 'whatsapp',
				to: toWaId.split('@')[0],
				type: 'text',
				text: { body: text },
			}),
		});
		const messages = data.messages as Array<{ id?: string }> | undefined;
		return { providerMessageId: messages?.[0]?.id ?? null };
	},

	async sendMedia(ctx, toWaId, media: SendMediaInput) {
		const { phoneNumberId, wabaToken } = creds(ctx);
		if (media.isBase64) {
			throw new Error(
				'Meta Cloud: envio de mídia exige URL pública (suba no Bunny antes)',
			);
		}
		const kind = media.kind === 'document' ? 'document' : media.kind;
		const payload: Record<string, unknown> = {
			messaging_product: 'whatsapp',
			to: toWaId.split('@')[0],
			type: kind,
			[kind]: {
				link: media.urlOrBase64,
				...(media.caption && kind !== 'audio'
					? { caption: media.caption }
					: {}),
				...(kind === 'document' && media.fileName
					? { filename: media.fileName }
					: {}),
			},
		};
		const data = await mfetch(`${GRAPH}/${phoneNumberId}/messages`, wabaToken, {
			method: 'POST',
			body: JSON.stringify(payload),
		});
		const messages = data.messages as Array<{ id?: string }> | undefined;
		return { providerMessageId: messages?.[0]?.id ?? null };
	},

	async markRead(ctx, _waChatId, providerMessageId) {
		const { phoneNumberId, wabaToken } = creds(ctx);
		await mfetch(`${GRAPH}/${phoneNumberId}/messages`, wabaToken, {
			method: 'POST',
			body: JSON.stringify({
				messaging_product: 'whatsapp',
				status: 'read',
				message_id: providerMessageId,
			}),
		}).catch(() => ({}));
	},

	parseWebhook(body): OmniWebhookEvent[] {
		const d = asObj(body);
		if (!d || d.object !== 'whatsapp_business_account') return [];
		const out: OmniWebhookEvent[] = [];
		const entries = Array.isArray(d.entry) ? d.entry : [];
		for (const entryRaw of entries) {
			const entry = asObj(entryRaw);
			const changes = Array.isArray(entry?.changes) ? entry.changes : [];
			for (const changeRaw of changes) {
				const value = asObj(asObj(changeRaw)?.value);
				if (!value) continue;
				const contacts = Array.isArray(value.contacts) ? value.contacts : [];
				const contactName = str(asObj(asObj(contacts[0])?.profile)?.name);
				const messages = Array.isArray(value.messages) ? value.messages : [];
				for (const mRaw of messages) {
					const m = asObj(mRaw);
					if (!m) continue;
					const ev = parseMessageEntry(m, contactName);
					if (ev) out.push(ev);
				}
				const statuses = Array.isArray(value.statuses) ? value.statuses : [];
				for (const sRaw of statuses) {
					const s = asObj(sRaw);
					const id = str(s?.id);
					const status = str(s?.status);
					if (!id || !status) continue;
					if (
						status === 'sent' ||
						status === 'delivered' ||
						status === 'read'
					) {
						out.push({ type: 'status', providerMessageId: id, status });
					}
				}
			}
		}
		return out;
	},
};
