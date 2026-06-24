import sharp from 'sharp';
import { type GeminiImageMessage, openrouter } from './openrouter.js';
import { ToolEngineError } from './tool-errors.js';

/**
 * Geração de imagem (texto→imagem) para a Fábrica de Tools — reusa o MESMO
 * cliente OpenRouter + o parser de resposta do `editor-ai`/`previa` (Gemini
 * image), que já roda em produção. Devolve a imagem normalizada em PNG (buffer
 * + data URL pra preview). Modelo configurável por env, com default no já usado.
 */
const IMAGE_MODEL =
	process.env.OPENROUTER_IMAGE_MODEL ?? 'google/gemini-3-pro-image-preview';
const GEN_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 20 * 1_000_000; // 20 MB de teto na imagem gerada

export interface GenImageResult {
	png: Buffer;
	/** data URL `image/png` pra preview inline (não cobra storage). */
	pngBase64: string;
}

async function downloadAsDataUrl(
	url: string,
	signal: AbortSignal,
): Promise<string> {
	const res = await fetch(url, { signal });
	if (!res.ok)
		throw new ToolEngineError(502, 'Falha ao baixar a imagem gerada.');
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.byteLength > MAX_OUTPUT_BYTES) {
		throw new ToolEngineError(502, 'Imagem gerada grande demais.');
	}
	const mime = res.headers.get('content-type') || 'image/png';
	return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * Gera uma imagem a partir de `prompt` (+ até N imagens de referência). Lança
 * `ToolEngineError` em qualquer falha — o controller do motor faz refund da
 * invocação automaticamente, então o cliente nunca paga por uma geração falha.
 */
export async function generateToolImage(
	prompt: string,
	refs: Buffer[] = [],
	signal?: AbortSignal,
): Promise<GenImageResult> {
	if (!process.env.OPENROUTER_API_KEY) {
		throw new ToolEngineError(
			503,
			'Geração de imagem indisponível (sem chave OpenRouter).',
		);
	}
	const text = prompt.trim();
	if (!text) throw new ToolEngineError(400, 'Prompt vazio.');

	const timeout = AbortSignal.timeout(GEN_TIMEOUT_MS);
	const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

	// biome-ignore lint/suspicious/noExplicitAny: conteúdo multimodal OpenRouter
	const content: any[] = [{ type: 'text', text }];
	for (const ref of refs) {
		content.push({
			type: 'image_url',
			image_url: { url: `data:image/png;base64,${ref.toString('base64')}` },
		});
	}
	const body = {
		model: IMAGE_MODEL,
		messages: [{ role: 'user', content }],
		modalities: ['image', 'text'],
	};

	let result: string | null = null;
	try {
		const completion = await openrouter.chat.completions.create(
			// biome-ignore lint/suspicious/noExplicitAny: body multimodal + modalities fora do tipo do SDK
			body as any,
			{
				signal: combined,
				headers: {
					'HTTP-Referer':
						process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
					'X-Title': `${process.env.NEXT_PUBLIC_COMPANY_SYSTEM ?? 'Profissão Laser'} - Prompts Mágicos`,
				},
			},
		);
		const message = completion.choices[0]?.message as
			| GeminiImageMessage
			| undefined;

		// 0. campo images (Gemini via OpenRouter)
		if (message?.images && message.images.length > 0) {
			const imageData = message.images[0];
			if (imageData.image_url && typeof imageData.image_url === 'object') {
				result = (imageData.image_url as { url: string }).url;
			} else if (typeof imageData.image_url === 'string') {
				result = imageData.image_url;
			}
		}
		// 1. fallback: markdown / URL no content
		if (!result && message?.content) {
			const md = message.content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
			if (md?.[1]) result = await downloadAsDataUrl(md[1], combined);
			if (!result) {
				const url = message.content.match(
					/(https?:\/\/[^\s"'<>]+\.(?:png|jpg|jpeg|gif|webp))/i,
				);
				if (url?.[1]) result = await downloadAsDataUrl(url[1], combined);
			}
		}
		if (!result) {
			const hint = message?.content
				? ` (${message.content.slice(0, 160)})`
				: '';
			throw new ToolEngineError(
				502,
				`O modelo não gerou imagem${hint}. Ajuste o tema.`,
			);
		}
	} catch (err: unknown) {
		if (err instanceof ToolEngineError) throw err;
		const e = err as {
			status?: number;
			code?: number;
			name?: string;
			message?: string;
		};
		if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
			throw new ToolEngineError(504, 'Tempo esgotado na geração da imagem.');
		}
		if (e?.status === 429 || e?.code === 429) {
			throw new ToolEngineError(
				429,
				'Limite de requisições. Tente em alguns segundos.',
			);
		}
		throw new ToolEngineError(
			502,
			`Erro na geração de imagem (${e?.status ?? '?'}): ${e?.message ?? 'falha'}`,
		);
	}

	// `result` é data URL, http (baixa) ou base64 puro → normaliza pra PNG.
	let decoded: Buffer;
	if (result.startsWith('data:')) {
		const m = result.match(/^data:[^;]+;base64,(.+)$/);
		decoded = Buffer.from(m ? m[1] : '', 'base64');
	} else if (result.startsWith('http')) {
		const dataUrl = await downloadAsDataUrl(result, combined);
		const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
		decoded = Buffer.from(m ? m[1] : '', 'base64');
	} else {
		decoded = Buffer.from(result, 'base64');
	}
	if (decoded.byteLength === 0) {
		throw new ToolEngineError(502, 'Imagem gerada vazia.');
	}
	if (decoded.byteLength > MAX_OUTPUT_BYTES) {
		throw new ToolEngineError(502, 'Imagem gerada grande demais.');
	}

	const png = await sharp(decoded).png().toBuffer();
	const pngBase64 = `data:image/png;base64,${png.toString('base64')}`;
	return { png, pngBase64 };
}
