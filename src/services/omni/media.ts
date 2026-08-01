import { openrouter } from '../../lib/openrouter.js';

/**
 * Pré-processamento multimodal do OmniResposta: transforma áudio/imagem do
 * cliente em TEXTO antes do turno da IA (o pipeline injeta como transcrição).
 * Funções puras (sem repositório): recebem URL/base64 e devolvem string|null.
 * Falha NUNCA propaga — devolve null e o pipeline usa um placeholder tipo
 * "[áudio recebido]" (atendimento não pode travar por mídia exótica).
 */

const MEDIA_MODEL = process.env.OMNI_MEDIA_MODEL || 'google/gemini-2.5-flash';
/** Áudio acima disso não é transcrito (custo/latência). */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

function audioFormatFromMime(mime: string): string {
	const m = mime.toLowerCase();
	if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
	if (m.includes('wav')) return 'wav';
	if (m.includes('ogg') || m.includes('opus')) return 'ogg';
	if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
	if (m.includes('webm')) return 'webm';
	return 'mp3';
}

async function fetchAsBase64(
	url: string,
	maxBytes: number,
): Promise<{ base64: string; mime: string } | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
		if (!res.ok) return null;
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length === 0 || buf.length > maxBytes) return null;
		const mime = res.headers.get('content-type') ?? 'application/octet-stream';
		return { base64: buf.toString('base64'), mime };
	} catch {
		return null;
	}
}

/**
 * Transcreve um áudio de WhatsApp (URL já re-hospedada no Bunny, ou base64).
 * Usa modelo multimodal via OpenRouter (`input_audio`). null = não transcrito.
 */
export async function transcribeAudio(src: {
	url?: string | null;
	base64?: string | null;
	mime?: string | null;
}): Promise<string | null> {
	try {
		let base64 = src.base64 ?? null;
		let mime = src.mime ?? 'audio/ogg';
		if (!base64 && src.url) {
			const fetched = await fetchAsBase64(src.url, MAX_AUDIO_BYTES);
			if (!fetched) return null;
			base64 = fetched.base64;
			mime = src.mime ?? fetched.mime;
		}
		if (!base64) return null;
		if (Buffer.byteLength(base64, 'base64') > MAX_AUDIO_BYTES) return null;

		const completion = await openrouter.chat.completions.create({
			model: MEDIA_MODEL,
			max_tokens: 500,
			temperature: 0,
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: 'Transcreva este áudio em português, fielmente, sem comentários. Responda SÓ com a transcrição.',
						},
						{
							// O SDK da OpenAI restringe `format` a wav|mp3; o OpenRouter
							// repassa outros formatos pro modelo (Gemini aceita ogg/opus).
							type: 'input_audio',
							input_audio: {
								data: base64,
								format: audioFormatFromMime(mime),
							},
							// biome-ignore lint/suspicious/noExplicitAny: format fora do union do SDK
						} as any,
					],
				},
			],
		});
		const text = completion.choices[0]?.message?.content?.trim();
		return text || null;
	} catch (err) {
		console.error('[omni-media] transcrição falhou:', err);
		return null;
	}
}

/**
 * Descreve uma imagem recebida (contexto pro turno da IA). null = sem descrição.
 */
export async function describeImage(
	url: string,
	caption?: string | null,
): Promise<string | null> {
	try {
		const completion = await openrouter.chat.completions.create({
			model: MEDIA_MODEL,
			max_tokens: 300,
			temperature: 0,
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: `Descreva esta imagem em 1-3 frases objetivas, em português (é uma mensagem de cliente num atendimento). ${
								caption ? `Legenda enviada junto: "${caption}".` : ''
							} Responda SÓ com a descrição.`,
						},
						{ type: 'image_url', image_url: { url } },
					],
				},
			],
		});
		const text = completion.choices[0]?.message?.content?.trim();
		return text || null;
	} catch (err) {
		console.error('[omni-media] descrição de imagem falhou:', err);
		return null;
	}
}
