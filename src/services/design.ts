import crypto from 'node:crypto';
import {
	deleteDesignThumbnailByUrl,
	uploadDesignThumbnail,
} from '../lib/storage.js';
import { designRepository } from '../repositories/design.js';
import type {
	CreateDesignInput,
	Design,
	UpdateDesignInput,
} from '../types/design.js';

interface ListParams {
	customerId: string;
	page: number;
	limit: number;
	templateId?: string;
	search?: string;
}

class DesignService {
	async list(params: ListParams) {
		const { data, total } = await designRepository.listByCustomer(params);
		return { data, total, page: params.page, limit: params.limit };
	}

	async findById(id: string, customerId: string): Promise<Design> {
		return designRepository.findByIdAndCustomer(id, customerId);
	}

	async create(customerId: string, data: CreateDesignInput): Promise<Design> {
		return designRepository.create({
			...data,
			id: crypto.randomUUID(),
			customerId,
		});
	}

	async update(
		id: string,
		customerId: string,
		data: UpdateDesignInput,
	): Promise<Design> {
		return designRepository.update(id, customerId, data);
	}

	async uploadThumbnail(
		id: string,
		customerId: string,
		buffer: Buffer,
		mimetype: string,
		filename: string,
	): Promise<Design> {
		const existing = await designRepository.findByIdAndCustomer(id, customerId);

		const ext = filename.split('.').pop()?.toLowerCase() || 'png';
		const path = `${customerId}/${id}/${crypto.randomUUID()}.${ext}`;
		const newUrl = await uploadDesignThumbnail(buffer, path, mimetype);

		const updated = await designRepository.updateThumbnail(
			id,
			customerId,
			newUrl,
		);

		if (existing.thumbnailUrl && existing.thumbnailUrl !== newUrl) {
			try {
				await deleteDesignThumbnailByUrl(existing.thumbnailUrl);
			} catch (err) {
				console.warn('Falha ao remover thumbnail antigo:', err);
			}
		}

		return updated;
	}

	async delete(id: string, customerId: string): Promise<void> {
		const { thumbnailUrl } = await designRepository.delete(id, customerId);
		if (thumbnailUrl) {
			try {
				await deleteDesignThumbnailByUrl(thumbnailUrl);
			} catch (err) {
				console.warn('Falha ao remover thumbnail do design:', err);
			}
		}
	}
}

export const designService = new DesignService();
