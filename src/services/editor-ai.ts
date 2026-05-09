import sharp from 'sharp';
import {
	createEditPrompt,
	createGeneratePrompt,
	createInpaintingPrompt,
} from '../lib/editor-ai-prompts.js';
import { type GeminiImageMessage, openrouter } from '../lib/openrouter.js';
import { removeBackgroundLocal } from '../lib/u2net.js';
import type {
	ApplyColorRequest,
	EditorAiRequest,
	RemoveBackgroundRequest,
} from '../types/editor-ai.js';

// Modelo do editor (porteira:325)
const EDITOR_MODEL = 'google/gemini-3-pro-image-preview';

class EditorAiService {
	// ── /editor/ai (porteira:231-437) ────────────────────────────────────────
	async generateOrEdit(
		body: EditorAiRequest,
	): Promise<{ imageBase64: string }> {
		if (!process.env.OPENROUTER_API_KEY) {
			throw new Error('Chave da API não configurada.');
		}

		const mode = body.mode ?? 'generate';
		const userPrompt = body.prompt.trim();
		if (!userPrompt) {
			throw new Error('Por favor, descreva o que você deseja.');
		}

		// biome-ignore lint/suspicious/noExplicitAny: OpenAI SDK message format aceita variantes que TypeScript não infere
		let messages: any[];

		if (mode === 'edit' && body.image) {
			const base64 = body.image.includes(',')
				? body.image.split(',')[1]
				: body.image;
			if (!base64) {
				throw new Error('Imagem inválida para edição.');
			}

			const isInpainting = !!body.regionInfo || !!body.mask;
			const editPrompt = isInpainting
				? createInpaintingPrompt(userPrompt, body.regionInfo)
				: createEditPrompt(userPrompt);

			// biome-ignore lint/suspicious/noExplicitAny: conteúdo multimodal OpenAI
			const content: any[] = [
				{ type: 'text', text: editPrompt },
				{
					type: 'image_url',
					image_url: { url: `data:image/png;base64,${base64}` },
				},
			];

			if (body.mask) {
				const maskBase64 = body.mask.includes(',')
					? body.mask.split(',')[1]
					: body.mask;
				if (maskBase64) {
					content.push({
						type: 'text',
						text: 'MASK IMAGE: The white area in the following mask indicates the region to be edited. Keep all black areas unchanged.',
					});
					content.push({
						type: 'image_url',
						image_url: { url: `data:image/png;base64,${maskBase64}` },
					});
				}
			}

			messages = [{ role: 'user', content }];
		} else {
			const generatePrompt = createGeneratePrompt(userPrompt);
			messages = [{ role: 'user', content: generatePrompt }];
		}

		try {
			const completion = await openrouter.chat.completions.create(
				{ model: EDITOR_MODEL, messages },
				{
					headers: {
						'HTTP-Referer':
							process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
						'X-Title': `${process.env.NEXT_PUBLIC_COMPANY_SYSTEM ?? 'Profissão Laser'} - Editor IA`,
					},
				},
			);

			const message = completion.choices[0]?.message as
				| GeminiImageMessage
				| undefined;
			let result: string | null = null;

			// porteira:340-348
			if (message?.images && message.images.length > 0) {
				const imageData = message.images[0];
				if (imageData.image_url && typeof imageData.image_url === 'object') {
					result = (imageData.image_url as { url: string }).url;
				} else if (typeof imageData.image_url === 'string') {
					result = imageData.image_url;
				}
			}

			// porteira:351-380 — fallback markdown / URL
			if (!result && message?.content) {
				const markdownMatch = message.content.match(
					/!\[.*?\]\((https?:\/\/[^)]+)\)/,
				);
				if (markdownMatch?.[1]) {
					try {
						const imageResponse = await fetch(markdownMatch[1]);
						if (imageResponse.ok) {
							const imageBuffer = await imageResponse.arrayBuffer();
							result = `data:image/png;base64,${Buffer.from(imageBuffer).toString('base64')}`;
						}
					} catch {
						// ignore
					}
				}

				if (!result) {
					const urlMatch = message.content.match(
						/(https?:\/\/[^\s"'<>]+\.(?:png|jpg|jpeg|gif|webp))/i,
					);
					if (urlMatch?.[1]) {
						try {
							const imageResponse = await fetch(urlMatch[1]);
							if (imageResponse.ok) {
								const imageBuffer = await imageResponse.arrayBuffer();
								result = `data:image/png;base64,${Buffer.from(imageBuffer).toString('base64')}`;
							}
						} catch {
							// ignore
						}
					}
				}
			}

			if (!result) {
				if (message?.content) {
					throw new Error(
						`IA não gerou imagem. Resposta: ${message.content.substring(0, 300)}`,
					);
				}
				throw new Error('Não foi possível obter a imagem da IA.');
			}

			// porteira:394-408 — normalizar formato
			let finalBase64: string;
			if (result.startsWith('data:image')) {
				finalBase64 = result;
			} else if (result.startsWith('http')) {
				const imageResponse = await fetch(result);
				if (!imageResponse.ok) {
					throw new Error('Falha ao baixar imagem da URL.');
				}
				const imageBuffer = await imageResponse.arrayBuffer();
				finalBase64 = `data:image/png;base64,${Buffer.from(imageBuffer).toString('base64')}`;
			} else {
				finalBase64 = `data:image/png;base64,${result}`;
			}

			return { imageBase64: finalBase64 };
		} catch (error: unknown) {
			const err = error as {
				status?: number;
				code?: number;
				message?: string;
			};
			if (err.status === 429 || err.code === 429) {
				throw new Error(
					'Limite de requisições atingido. Aguarde alguns segundos e tente novamente.',
				);
			}
			if (err.status) {
				throw new Error(
					`Erro da IA (${err.status}): ${err.message ?? 'Falha ao processar'}`,
				);
			}
			if (error instanceof Error) throw error;
			throw new Error('Falha ao processar imagem com IA.');
		}
	}

	// ── /editor/remove-background — U2-Net self-hosted (Apache 2.0) ─────────
	// Substitui remove.bg API. 100% local, sem rate limit, sem env var paga.
	async removeBackground(
		body: RemoveBackgroundRequest,
	): Promise<{ imageBase64: string }> {
		const base64 = body.image.includes(',')
			? body.image.split(',')[1]
			: body.image;
		if (!base64) throw new Error('Imagem inválida.');

		const inputBuffer = Buffer.from(base64, 'base64');
		const outputBuffer = await removeBackgroundLocal(inputBuffer);

		return {
			imageBase64: `data:image/png;base64,${outputBuffer.toString('base64')}`,
		};
	}

	// ── /editor/apply-color — Sharp pixel tint ───────────────────────────────
	// Substitui o Jimp do porteira (apply-color/route.ts:65-87) com Sharp
	async applyColor(body: ApplyColorRequest): Promise<{ imageBase64: string }> {
		const base64 = body.image.includes(',')
			? body.image.split(',')[1]
			: body.image;
		if (!base64) throw new Error('Imagem inválida.');

		const hex = body.targetColor.startsWith('#')
			? body.targetColor.slice(1)
			: body.targetColor;
		const r = parseInt(hex.slice(0, 2), 16);
		const g = parseInt(hex.slice(2, 4), 16);
		const b = parseInt(hex.slice(4, 6), 16);

		const inputBuffer = Buffer.from(base64, 'base64');

		// Carregar com sharp em RGBA, manipular pixels não-transparentes,
		// preservando o alpha exato (mesma lógica que o porteira).
		const { data, info } = await sharp(inputBuffer)
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });

		const pixels = Buffer.from(data); // mutable copy
		for (let i = 0; i < pixels.length; i += 4) {
			const a = pixels[i + 3];
			if (a === 0) continue; // pixel totalmente transparente: pular
			pixels[i] = r;
			pixels[i + 1] = g;
			pixels[i + 2] = b;
			// alpha intocado
		}

		const resultBuffer = await sharp(pixels, {
			raw: {
				width: info.width,
				height: info.height,
				channels: 4,
			},
		})
			.png()
			.toBuffer();

		return {
			imageBase64: `data:image/png;base64,${resultBuffer.toString('base64')}`,
		};
	}
}

export const editorAiService = new EditorAiService();
