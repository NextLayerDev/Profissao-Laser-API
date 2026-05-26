import crypto from 'node:crypto';
import {
	type GeminiImageMessage,
	openrouter,
	PREVIA_MODEL,
} from '../lib/openrouter.js';
import { generatePrompt, imageUrlToBase64 } from '../lib/previa-prompt.js';
import { deletePreviaImageByUrl, uploadPreviaImage } from '../lib/storage.js';
import { reserveUpvoxTool } from '../lib/upvox-guard.js';
import { previaRepository } from '../repositories/previa.js';
import { customerWatermarkRepository } from '../repositories/watermark.js';
import type {
	GeneratePreviaInput,
	Previa,
	UpdatePreviaInput,
} from '../types/previa.js';
import { laserProductService } from './laser-product.js';

class PreviaService {
	async generate(
		customerId: string,
		jwt: string,
		body: GeneratePreviaInput,
		unlimited?: boolean,
	): Promise<Previa> {
		const {
			productVariantId,
			imagelogo_url,
			laserSettings,
			personalizationType,
			customName,
			instrucoesPersonalizadas,
			textoLenteDireita,
			textoLenteEsquerda,
			modoLentes,
			useWatermark,
			watermarkMode,
			name,
			notes,
		} = body;

		// ── Reserva uso na upvox-api (entitlement + capacity + cobrança). ──────
		const usage = await reserveUpvoxTool({
			jwt,
			customerId,
			toolKey: body.toolKey,
			courseSlug: body.courseSlug,
			unlimited,
		});

		try {
			// ── Resolver variant do catálogo (substitui imageproduct_url custom) ──
			const { variant, product } =
				await laserProductService.getActiveVariantForPreview(productVariantId);
			const imageproductUrl = variant.imageUrl;
			const productName = product.name;
			const productColor = variant.colorName ?? variant.tipo ?? null;

			// ── Resolver marca d'água (se solicitada) ────────────────────────────
			// Resolve modo: watermarkMode > useWatermark (deprecated alias).
			const resolvedWatermarkMode: 'none' | 'corners' | 'tiled' =
				watermarkMode ?? (useWatermark === true ? 'corners' : 'none');

			let watermarkUrl: string | null = null;
			if (resolvedWatermarkMode !== 'none') {
				const watermark =
					await customerWatermarkRepository.findByCustomerId(customerId);
				if (!watermark) {
					throw new Error("Marca d'água não cadastrada");
				}
				watermarkUrl = watermark.imageUrl;
			}

			// Material default do produto sobrescreve o laserSettings.material só se
			// o customer não tiver passado nada útil (mantém preferência do customer).
			const effectiveLaserSettings = {
				...laserSettings,
				material:
					laserSettings.material && laserSettings.material.length > 0
						? laserSettings.material
						: (product.defaultMaterial ?? laserSettings.material),
			};

			// ── Validações de logo / texto (mantidas) ───────────────────────────
			const isTextOnly =
				personalizationType === 'text' ||
				effectiveLaserSettings.apenasTexto === true;

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

			// ── Converter imagens em paralelo (produto + logo + watermark opcionais) ──
			const willSendLogo = !!(imagelogo_url && !isTextOnly);
			const willSendWatermark = !!watermarkUrl;

			const imagePromises: Promise<string>[] = [
				imageUrlToBase64(imageproductUrl),
			];
			if (willSendLogo) imagePromises.push(imageUrlToBase64(imagelogo_url!));
			if (willSendWatermark)
				imagePromises.push(imageUrlToBase64(watermarkUrl as string));

			const base64s = await Promise.all(imagePromises);
			const imageproductB64 = base64s[0];
			const imagelogoB64 = willSendLogo ? base64s[1] : null;
			const watermarkB64 = willSendWatermark
				? base64s[willSendLogo ? 2 : 1]
				: null;

			// ── Gerar prompt dinâmico (sem imagebase, com flag de watermark) ────
			const prompt = generatePrompt(
				productName,
				{ ...effectiveLaserSettings, apenasTexto: isTextOnly },
				effectiveLaserSettings.comNome === 'com' || isTextOnly,
				customName ?? undefined,
				instrucoesPersonalizadas ?? null,
				modoLentes,
				textoLenteDireita ?? undefined,
				textoLenteEsquerda ?? undefined,
				resolvedWatermarkMode,
				productColor,
			);

			// ── Montar mensagem (produto + logo opcional + watermark opcional) ──
			const messageContent: Array<
				| { type: 'text'; text: string }
				| { type: 'image_url'; image_url: { url: string } }
			> = [
				{ type: 'text', text: prompt },
				{
					type: 'image_url',
					image_url: { url: `data:image/png;base64,${imageproductB64}` },
				},
			];
			if (imagelogoB64) {
				messageContent.push({
					type: 'image_url',
					image_url: { url: `data:image/png;base64,${imagelogoB64}` },
				});
			}
			if (watermarkB64) {
				messageContent.push({
					type: 'image_url',
					image_url: { url: `data:image/png;base64,${watermarkB64}` },
				});
			}

			// ── Chamar OpenRouter/Gemini ─────────────────────────────────────────
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

			// ── Extrair imagem do retorno ────────────────────────────────────────
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
			// imagebaseUrl fica vazio pra registros novos (drop total da feature).
			// imageproductUrl recebe a URL da variant escolhida.
			const previa = await previaRepository.create({
				id: crypto.randomUUID(),
				customerId,
				name: name ?? productName,
				productName,
				productColor,
				imagebaseUrl: '',
				imageproductUrl,
				imagelogoUrl: imagelogo_url ?? null,
				previewUrl,
				personalizationType,
				customName: customName ?? null,
				instrucoesPersonalizadas: instrucoesPersonalizadas ?? null,
				textoLenteDireita: textoLenteDireita ?? null,
				textoLenteEsquerda: textoLenteEsquerda ?? null,
				modoLentes: modoLentes ?? false,
				laserSettings: effectiveLaserSettings,
				notes: notes ?? null,
				prompt,
				aiModel: PREVIA_MODEL,
			});
			await usage.commit();
			return previa;
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			await usage.rollback(`previa.generate: ${reason}`);
			throw err;
		}
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

	async update(
		customerId: string,
		id: string,
		data: UpdatePreviaInput,
	): Promise<Previa> {
		return previaRepository.update(id, customerId, data);
	}

	/** Admin — stats globais de uso da feature. */
	async getUsageStats() {
		return previaRepository.getUsageStats();
	}

	/** Admin — lista paginada de customers que geraram prévias, com stats. */
	async listUsageUsers(params: {
		page: number;
		limit: number;
		search?: string;
	}) {
		const { data, total } = await previaRepository.listUsageUsers(params);
		return { data, total, page: params.page, limit: params.limit };
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
