import type {
	OmniProviderKind,
	OmniWebhookEvent,
} from '../../../types/omni.js';

/** Credenciais DECRIPTADAS da instância (montadas por buildProviderCtx). */
export interface ProviderCtx {
	instanceId: string;
	zapi?: { instanceId: string; instanceToken: string; clientToken: string };
	evolution?: { baseUrl: string; apiKey: string; instanceName: string };
	meta?: { phoneNumberId: string; wabaToken: string };
}

export interface SendMediaInput {
	kind: 'image' | 'audio' | 'video' | 'document';
	/** URL pública OU base64 puro (sem data URI) conforme isBase64. */
	urlOrBase64: string;
	isBase64: boolean;
	mime: string;
	fileName?: string;
	caption?: string;
}

/**
 * Contrato único dos provedores de WhatsApp (Z-API / Evolution / Meta Cloud).
 * Todos os payloads de webhook viram `OmniWebhookEvent[]` via parseWebhook —
 * o resto do sistema nunca vê payload cru de provedor.
 */
export interface OmniProvider {
	readonly kind: OmniProviderKind;
	/** Z-API (partner on-demand) / Evolution (instance/create). Meta: n/a. */
	createRemoteInstance?(name: string): Promise<{
		zapiInstanceId?: string;
		zapiToken?: string;
		evolutionInstance?: string;
	}>;
	connect(
		ctx: ProviderCtx,
	): Promise<{ qrCodeBase64: string | null; status: string }>;
	getStatus(ctx: ProviderCtx): Promise<{
		connected: boolean;
		phoneNumber?: string | null;
		profileName?: string | null;
		qrCodeBase64?: string | null;
	}>;
	disconnect?(ctx: ProviderCtx): Promise<void>;
	/** Aponta o webhook do provedor pra nossa URL. Meta: no-op (painel). */
	configureWebhook(ctx: ProviderCtx, url: string): Promise<void>;
	sendText(
		ctx: ProviderCtx,
		toWaId: string,
		text: string,
	): Promise<{ providerMessageId: string | null }>;
	sendMedia(
		ctx: ProviderCtx,
		toWaId: string,
		media: SendMediaInput,
	): Promise<{ providerMessageId: string | null }>;
	markRead?(
		ctx: ProviderCtx,
		waChatId: string,
		providerMessageId: string,
	): Promise<void>;
	parseWebhook(body: unknown): OmniWebhookEvent[];
}
