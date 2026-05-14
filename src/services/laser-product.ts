import crypto from 'node:crypto';
import {
	deleteLaserProductImageByUrl,
	uploadLaserProductImage,
} from '../lib/storage.js';
import { laserProductRepository } from '../repositories/laser-product.js';
import type {
	CreateLaserProductInput,
	CreateLaserProductVariantInput,
	LaserProduct,
	LaserProductVariant,
	LaserProductWithVariants,
	UpdateLaserProductInput,
	UpdateLaserProductVariantInput,
} from '../types/laser-product.js';

interface ListParams {
	page: number;
	limit: number;
	category?: string;
	search?: string;
	status?: 'ativo' | 'inativo';
	includeInactive?: boolean;
}

class LaserProductService {
	// ── Products ─────────────────────────────────────────────────────────────

	async list(params: ListParams) {
		const { data, total } = await laserProductRepository.list(params);
		return { data, total, page: params.page, limit: params.limit };
	}

	async findByIdWithVariants(
		id: string,
		opts: { includeInactiveVariants?: boolean } = {},
	): Promise<LaserProductWithVariants> {
		return laserProductRepository.findByIdWithVariants(id, opts);
	}

	async create(
		data: CreateLaserProductInput,
		createdBy: string | null,
	): Promise<LaserProduct> {
		return laserProductRepository.create({
			...data,
			id: crypto.randomUUID(),
			createdBy,
		});
	}

	async update(
		id: string,
		data: UpdateLaserProductInput,
	): Promise<LaserProduct> {
		return laserProductRepository.update(id, data);
	}

	async delete(id: string): Promise<void> {
		const { variantImageUrls } = await laserProductRepository.delete(id);
		// Best-effort cleanup das imagens das variants no CDN
		for (const url of variantImageUrls) {
			try {
				await deleteLaserProductImageByUrl(url);
			} catch (err) {
				console.warn('Falha ao remover imagem de variant:', err);
			}
		}
	}

	// ── Variants ─────────────────────────────────────────────────────────────

	async listVariants(
		productId: string,
		opts: { includeInactiveVariants?: boolean } = {},
	): Promise<LaserProductVariant[]> {
		return laserProductRepository.listVariantsByProduct(productId, opts);
	}

	async createVariant(
		productId: string,
		data: CreateLaserProductVariantInput,
	): Promise<LaserProductVariant> {
		// Garantir que o produto existe
		await laserProductRepository.findById(productId);
		return laserProductRepository.createVariant(productId, {
			...data,
			id: crypto.randomUUID(),
		});
	}

	async updateVariant(
		productId: string,
		variantId: string,
		data: UpdateLaserProductVariantInput,
	): Promise<LaserProductVariant> {
		return laserProductRepository.updateVariant(variantId, productId, data);
	}

	async uploadVariantImage(
		productId: string,
		variantId: string,
		buffer: Buffer,
		mimetype: string,
		filename: string,
	): Promise<LaserProductVariant> {
		const { variant } = await laserProductRepository.findVariantById(variantId);
		if (variant.productId !== productId) {
			throw new Error('Variant not found');
		}

		const ext = filename.split('.').pop()?.toLowerCase() || 'png';
		const path = `${productId}/${variantId}/${crypto.randomUUID()}.${ext}`;
		const newUrl = await uploadLaserProductImage(buffer, path, mimetype);

		const updated = await laserProductRepository.updateVariant(
			variantId,
			productId,
			{ imageUrl: newUrl },
		);

		// Cleanup da imagem antiga
		if (variant.imageUrl && variant.imageUrl !== newUrl) {
			try {
				await deleteLaserProductImageByUrl(variant.imageUrl);
			} catch (err) {
				console.warn('Falha ao remover imagem antiga da variant:', err);
			}
		}

		return updated;
	}

	async deleteVariant(productId: string, variantId: string): Promise<void> {
		const { imageUrl } = await laserProductRepository.deleteVariant(
			variantId,
			productId,
		);
		if (imageUrl) {
			try {
				await deleteLaserProductImageByUrl(imageUrl);
			} catch (err) {
				console.warn('Falha ao remover imagem da variant:', err);
			}
		}
	}

	// ── Used by previa service ───────────────────────────────────────────────

	async getActiveVariantForPreview(variantId: string): Promise<{
		variant: LaserProductVariant;
		product: LaserProduct;
	}> {
		const result = await laserProductRepository.findVariantById(variantId);
		if (
			result.variant.status !== 'ativo' ||
			result.product.status !== 'ativo'
		) {
			throw new Error('Variant inválido ou indisponível');
		}
		return result;
	}
}

export const laserProductService = new LaserProductService();
