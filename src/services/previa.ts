import crypto from 'node:crypto';
import { startOfTomorrowBRT } from '../lib/datetime.js';
import {
	type GeminiImageMessage,
	openrouter,
	PREVIA_MODEL,
} from '../lib/openrouter.js';
import { generatePrompt, imageUrlToBase64 } from '../lib/previa-prompt.js';
import { DAILY_PREVIA_LIMIT, DailyLimitError } from '../lib/previa-quota.js';
import { deletePreviaImageByUrl, uploadPreviaImage } from '../lib/storage.js';
import { previaRepository } from '../repositories/previa.js';
import type {
	GeneratePreviaInput,
	Previa,
	UpdatePreviaInput,
} from '../types/previa.js';

class PreviaService {
	async generate(
		customerId: string,
		body: GeneratePreviaInput,
	): Promise<Previa> {
		const {
			imagebase_url,
			imageproduct_url,
			imagelogo_url,
			productName,
			productColor,
			laserSettings,
			personalizationType,
			customName,
			instrucoesPersonalizadas,
			textoLenteDireita,
			textoLenteEsquerda,
			modoLentes,
			name,
			notes,
		} = body;

		// ── Quota diário (5 prévias/dia, reset 00:00 BRT) ───────────────────
		const used = await previaRepository.countTodayByCustomer(customerId);
		if (used >= DAILY_PREVIA_LIMIT) {
			throw new DailyLimitError(
				DAILY_PREVIA_LIMIT,
				used,
				startOfTomorrowBRT().toISOString(),
			);
		}

		// ── Validações (porteira:1476-1510) ─────────────────────────────────
		const isTextOnly =
			personalizationType === 'text' || laserSettings.apenasTexto === true;

		if (!imagebase_url || !imageproduct_url) {
			throw new Error('Imagens base e produto são obrigatórias');
		}
		if (!isTextOnly && !imagelogo_url) {
			throw new Error('Imagem do logo é obrigatória');
		}
		if (isTextOnly && !modoLentes && !customName) {
			throw new Error('Texto para gravação é obrigatório');
		}
		if (modoLentes && !textoLenteDireita && !textoLenteEsquerda) {
			throw new Error('Texto para pelo menos uma lente é obrigatório');
		}
		if (!process.env.OPENROUTER_API_KEY) {
			throw new Error('Chave da API não configurada');
		}

		// ── Converter imagens em paralelo (porteira:1518-1531) ──────────────
		const imagePromises: Promise<string>[] = [
			imageUrlToBase64(imagebase_url),
			imageUrlToBase64(imageproduct_url),
		];
		if (imagelogo_url && !isTextOnly) {
			imagePromises.push(imageUrlToBase64(imagelogo_url));
		}
		const [imagebaseB64, imageproductB64, imagelogoB64] =
			await Promise.all(imagePromises);

		// ── Gerar prompt dinâmico (porteira:1534-1543) ──────────────────────
		const prompt = generatePrompt(
			productName,
			{ ...laserSettings, apenasTexto: isTextOnly },
			laserSettings.comNome === 'com' || isTextOnly,
			customName ?? undefined,
			instrucoesPersonalizadas ?? null,
			modoLentes,
			textoLenteDireita ?? undefined,
			textoLenteEsquerda ?? undefined,
		);

		// ── Montar mensagem (porteira:1545-1573) ────────────────────────────
		const messageContent: Array<
			| { type: 'text'; text: string }
			| { type: 'image_url'; image_url: { url: string } }
		> = [
			{ type: 'text', text: prompt },
			{
				type: 'image_url',
				image_url: { url: `data:image/png;base64,${imagebaseB64}` },
			},
			{
				type: 'image_url',
				image_url: { url: `data:image/png;base64,${imageproductB64}` },
			},
		];
		if (imagelogoB64 && !isTextOnly) {
			messageContent.push({
				type: 'image_url',
				image_url: { url: `data:image/png;base64,${imagelogoB64}` },
			});
		}

		// ── Chamar OpenRouter/Gemini (porteira:1576-1593) ───────────────────
		const completion = await openrouter.chat.completions.create(
			{
				model: PREVIA_MODEL,
				// biome-ignore lint/suspicious/noExplicitAny: OpenAI SDK types are stricter than what OpenRouter accepts
				messages: [{ role: 'user', content: messageContent as any }],
			},
			{
				headers: {
					'HTTP-Referer':
						process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
					'X-Title': `${process.env.NEXT_PUBLIC_COMPANY_SYSTEM ?? 'Profissão Laser'} - Sistema de Prévias`,
				},
			},
		);

		// ── Extrair imagem do retorno (porteira:1595-1618) ──────────────────
		const message = completion.choices[0]?.message as
			| GeminiImageMessage
			| undefined;
		let result: string | null = null;

		if (message?.images && message.images.length > 0) {
			const imageData = message.images[0];
			if (imageData.image_url && typeof imageData.image_url === 'object') {
				result = (imageData.image_url as { url: string }).url;
			} else if (typeof imageData.image_url === 'string') {
				result = imageData.image_url;
			}
		}
		if (!result && message?.content) {
			result = message.content;
		}
		if (!result) {
			throw new Error('Nenhuma resposta da IA');
		}

		// ── Persistir imagem no Bunny CDN ───────────────────────────────────
		const previewUrl = await this.persistImage(result, customerId);

		// ── Salvar registro ─────────────────────────────────────────────────
		return previaRepository.create({
			id: crypto.randomUUID(),
			customerId,
			name: name ?? productName,
			productName,
			productColor: productColor ?? null,
			imagebaseUrl: imagebase_url,
			imageproductUrl: imageproduct_url,
			imagelogoUrl: imagelogo_url ?? null,
			previewUrl,
			personalizationType,
			customName: customName ?? null,
			instrucoesPersonalizadas: instrucoesPersonalizadas ?? null,
			textoLenteDireita: textoLenteDireita ?? null,
			textoLenteEsquerda: textoLenteEsquerda ?? null,
			modoLentes: modoLentes ?? false,
			laserSettings,
			notes: notes ?? null,
			prompt,
			aiModel: PREVIA_MODEL,
		});
	}

	private async persistImage(
		result: string,
		customerId: string,
	): Promise<string> {
		// Caso 1: data URL → decode + upload
		if (result.startsWith('data:')) {
			const match = /^data:([^;]+);base64,(.+)$/.exec(result);
			if (!match) {
				throw new Error('Formato de imagem inválido retornado pela IA');
			}
			const mime = match[1];
			const buffer = Buffer.from(match[2], 'base64');
			const ext = mime.split('/')[1]?.split('+')[0] ?? 'png';
			const path = `${customerId}/${crypto.randomUUID()}.${ext}`;
			return uploadPreviaImage(buffer, path, mime);
		}

		// Caso 2: URL HTTP(S) → baixar e re-hospedar (mais seguro contra link expirar)
		if (result.startsWith('http://') || result.startsWith('https://')) {
			const response = await fetch(result);
			if (!response.ok) {
				throw new Error(`Falha ao baixar preview da IA: ${response.status}`);
			}
			const arrayBuffer = await response.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			const mime = response.headers.get('content-type') ?? 'image/png';
			const ext = mime.split('/')[1]?.split('+')[0] ?? 'png';
			const path = `${customerId}/${crypto.randomUUID()}.${ext}`;
			return uploadPreviaImage(buffer, path, mime);
		}

		throw new Error('Formato de resposta da IA não reconhecido');
	}

	async listHistory(customerId: string, page: number, limit: number) {
		const { data, total } = await previaRepository.listByCustomer({
			customerId,
			page,
			limit,
		});
		return { data, total, page, limit };
	}

	async getQuota(customerId: string): Promise<{
		limit: number;
		used: number;
		remaining: number;
		resetsAt: string;
	}> {
		const used = await previaRepository.countTodayByCustomer(customerId);
		return {
			limit: DAILY_PREVIA_LIMIT,
			used,
			remaining: Math.max(0, DAILY_PREVIA_LIMIT - used),
			resetsAt: startOfTomorrowBRT().toISOString(),
		};
	}

	async update(
		customerId: string,
		id: string,
		data: UpdatePreviaInput,
	): Promise<Previa> {
		return previaRepository.update(id, customerId, data);
	}

	async delete(customerId: string, id: string): Promise<void> {
		const { previewUrl } = await previaRepository.delete(id, customerId);
		try {
			await deletePreviaImageByUrl(previewUrl);
		} catch (err) {
			// Não falhar a deleção do registro se o arquivo já não existe
			console.warn('Falha ao remover imagem do CDN:', err);
		}
	}
}

export const previaService = new PreviaService();
