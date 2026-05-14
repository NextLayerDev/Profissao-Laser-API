import crypto from 'node:crypto';
import {
	deleteWatermarkImageByUrl,
	uploadWatermarkImage,
} from '../lib/storage.js';
import { customerWatermarkRepository } from '../repositories/watermark.js';
import type { CustomerWatermark } from '../types/watermark.js';

class CustomerWatermarkService {
	async findByCustomer(customerId: string): Promise<CustomerWatermark | null> {
		return customerWatermarkRepository.findByCustomerId(customerId);
	}

	async upload(
		customerId: string,
		buffer: Buffer,
		mimetype: string,
		filename: string,
	): Promise<CustomerWatermark> {
		// Pega a watermark anterior pra remover do CDN depois
		const existing =
			await customerWatermarkRepository.findByCustomerId(customerId);

		const ext = filename.split('.').pop()?.toLowerCase() || 'png';
		const path = `${customerId}/${crypto.randomUUID()}.${ext}`;
		const newUrl = await uploadWatermarkImage(buffer, path, mimetype);

		const upserted = await customerWatermarkRepository.upsert(
			customerId,
			newUrl,
		);

		// Best-effort cleanup da imagem antiga (depois da upsert pra evitar perder
		// referência se algo der errado no meio).
		if (existing?.imageUrl && existing.imageUrl !== newUrl) {
			try {
				await deleteWatermarkImageByUrl(existing.imageUrl);
			} catch (err) {
				console.warn('Falha ao remover watermark antiga do CDN:', err);
			}
		}

		return upserted;
	}

	async delete(customerId: string): Promise<void> {
		const removed = await customerWatermarkRepository.delete(customerId);
		if (removed?.imageUrl) {
			try {
				await deleteWatermarkImageByUrl(removed.imageUrl);
			} catch (err) {
				console.warn('Falha ao remover watermark do CDN:', err);
			}
		}
	}
}

export const customerWatermarkService = new CustomerWatermarkService();
