/**
 * Tipos do OmniResposta (atendimento WhatsApp por IA). Espelham as tabelas
 * pl_omni_* do Demo_DB (sql/omni-resposta.sql) — snake_case como no banco;
 * o front consome como vem. Tokens de provedor ficam criptografados no banco
 * e NUNCA saem nas respostas (controllers projetam os campos).
 */

export type OmniProviderKind = 'zapi' | 'evolution' | 'meta';

export interface OmniInstance {
	id: string;
	owner_id: string;
	name: string;
	provider: OmniProviderKind;
	status: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'error';
	setup_status:
		| 'pending'
		| 'provider_created'
		| 'qr'
		| 'connected'
		| 'ready'
		| 'error';
	setup_error: string | null;
	phone_number: string | null;
	profile_name: string | null;
	webhook_secret: string;
	zapi_instance_id: string | null;
	zapi_instance_token: string | null;
	evolution_instance: string | null;
	meta_phone_number_id: string | null;
	meta_waba_token: string | null;
	meta_verify_token: string | null;
	meta_app_secret: string | null;
	ia_enabled: boolean;
	billing_status: 'ok' | 'no_balance';
	debounce_seconds: number;
	qr_code: string | null;
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

export interface OmniContact {
	id: string;
	instance_id: string;
	wa_id: string;
	name: string | null;
	push_name: string | null;
	profile_pic_url: string | null;
	created_at: string;
	updated_at: string;
}

export interface OmniChat {
	id: string;
	instance_id: string;
	contact_id: string;
	wa_chat_id: string;
	last_message: string | null;
	last_message_at: string | null;
	unread_count: number;
	assigned_to: 'ai' | 'human';
	assigned_user_id: string | null;
	assigned_user_name: string | null;
	ia_paused: boolean;
	is_pinned: boolean;
	is_archived: boolean;
	status: 'active' | 'waiting' | 'closed' | 'window_closed';
	lead_step: string | null;
	created_at: string;
	updated_at: string;
	/** join opcional (listChats) */
	contact?: OmniContact;
}

export interface OmniMessage {
	id: string;
	chat_id: string;
	instance_id: string;
	provider_message_id: string | null;
	direction: 'in' | 'out';
	author_type: 'contact' | 'ai' | 'user';
	author_id: string | null;
	sender_name: string | null;
	sender_wa_id: string | null;
	content: string | null;
	media_url: string | null;
	media_type: 'image' | 'video' | 'audio' | 'document' | 'sticker' | null;
	file_name: string | null;
	caption: string | null;
	quoted: unknown | null;
	transcription: string | null;
	status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
	ai_state: 'pending' | 'consumed' | 'skipped' | null;
	billing: 'billed' | 'refunded' | null;
	error: string | null;
	wa_timestamp: string;
	created_at: string;
}

export interface OmniAgent {
	id: string;
	instance_id: string;
	name: string;
	slug: string;
	role: 'router' | 'specialist';
	system_prompt: string;
	tool_description: string;
	model: string;
	temperature: number;
	position: number;
	enabled: boolean;
	created_at: string;
	updated_at: string;
}

export interface OmniTurn {
	id: string;
	chat_id: string;
	instance_id: string;
	status: 'running' | 'done' | 'failed' | 'no_balance';
	input_message_ids: string[];
	output_message_id: string | null;
	model: string | null;
	prompt_tokens: number | null;
	completion_tokens: number | null;
	voxxys_charged: number;
	error: string | null;
	created_at: string;
	finished_at: string | null;
}

export interface OmniKbFile {
	id: string;
	instance_id: string;
	name: string;
	url: string;
	mime: string;
	size_bytes: number;
	status: 'processing' | 'ready' | 'error';
	error: string | null;
	chunk_count: number;
	created_at: string;
}

/** Evento normalizado de webhook — TODO provedor vira isto (parseWebhook). */
export type OmniWebhookEvent =
	| {
			type: 'message';
			providerMessageId: string;
			waChatId: string;
			fromMe: boolean;
			isGroup: boolean;
			senderWaId: string;
			senderName?: string;
			timestamp: Date;
			kind:
				| 'text'
				| 'image'
				| 'audio'
				| 'video'
				| 'document'
				| 'sticker'
				| 'unsupported';
			text?: string;
			mediaUrl?: string;
			mediaBase64?: string;
			mediaProviderId?: string;
			mimeType?: string;
			fileName?: string;
			caption?: string;
			quoted?: unknown;
	  }
	| {
			type: 'status';
			providerMessageId: string;
			status: 'sent' | 'delivered' | 'read';
	  }
	| {
			type: 'connection';
			status: 'connected' | 'disconnected' | 'qr';
			qrCodeBase64?: string;
	  };
