import { supabase } from '../lib/supabase.js';
import type {
	CreateLaserProductInput,
	CreateLaserProductVariantInput,
	LaserProduct,
	LaserProductVariant,
	LaserProductWithVariants,
	UpdateLaserProductInput,
	UpdateLaserProductVariantInput,
} from '../types/laser-product.js';

interface ListLaserProductsParams {
	page: number;
	limit: number;
	category?: string;
	search?: string;
	status?: 'ativo' | 'inativo';
	includeInactive?: boolean;
}

class LaserProductRepository {
	// ── Products ─────────────────────────────────────────────────────────────

	async create(
		data: CreateLaserProductInput & { id: string; createdBy: string | null },
	): Promise<LaserProduct> {
		const { data: record, error } = await supabase
			.from('pl_laser_product')
			.insert(data)
			.select()
			.single();
		if (error || !record) {
			throw new Error(error?.message ?? 'Failed to create laser product');
		}
		return record as LaserProduct;
	}

	async findById(id: string): Promise<LaserProduct> {
		const { data, error } = await supabase
			.from('pl_laser_product')
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) throw new Error('Laser product not found');
		return data as LaserProduct;
	}

	async findByIdWithVariants(
		id: string,
		opts: { includeInactiveVariants?: boolean } = {},
	): Promise<LaserProductWithVariants> {
		const product = await this.findById(id);
		const variants = await this.listVariantsByProduct(id, opts);
		return { ...product, variants };
	}

	async list(
		params: ListLaserProductsParams,
	): Promise<{ data: LaserProduct[]; total: number }> {
		const { page, limit, category, search, status, includeInactive } = params;
		const from = (page - 1) * limit;
		const to = from + limit - 1;

		let query = supabase
			.from('pl_laser_product')
			.select('*', { count: 'exact' })
			.order('createdAt', { ascending: false });

		if (status) {
			query = query.eq('status', status);
		} else if (!includeInactive) {
			query = query.eq('status', 'ativo');
		}

		if (category) query = query.eq('category', category);
		if (search) {
			query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
		}

		const { data, error, count } = await query.range(from, to);
		if (error) throw new Error(error.message);
		return { data: (data ?? []) as LaserProduct[], total: count ?? 0 };
	}

	async update(
		id: string,
		data: UpdateLaserProductInput,
	): Promise<LaserProduct> {
		const { data: record, error } = await supabase
			.from('pl_laser_product')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single();
		if (error || !record) throw new Error('Laser product not found');
		return record as LaserProduct;
	}

	async delete(id: string): Promise<{ imageUrls: string[] }> {
		// Pegar URLs do produto + variants pra cleanup no CDN
		const { data: product } = await supabase
			.from('pl_laser_product')
			.select('imageUrl')
			.eq('id', id)
			.maybeSingle();
		const { data: variants } = await supabase
			.from('pl_laser_product_variant')
			.select('imageUrl')
			.eq('productId', id);

		const { error } = await supabase
			.from('pl_laser_product')
			.delete()
			.eq('id', id);
		if (error) throw new Error(error.message);

		const imageUrls = ((variants ?? []) as Array<{ imageUrl: string }>)
			.map((v) => v.imageUrl)
			.filter(Boolean);
		const productImageUrl = (product as { imageUrl: string | null } | null)
			?.imageUrl;
		if (productImageUrl) imageUrls.push(productImageUrl);
		return { imageUrls };
	}

	// ── Variants ─────────────────────────────────────────────────────────────

	async createVariant(
		productId: string,
		data: CreateLaserProductVariantInput & { id: string },
	): Promise<LaserProductVariant> {
		const { data: record, error } = await supabase
			.from('pl_laser_product_variant')
			.insert({ ...data, productId })
			.select()
			.single();
		if (error || !record) {
			throw new Error(error?.message ?? 'Failed to create variant');
		}
		return record as LaserProductVariant;
	}

	async listVariantsByProduct(
		productId: string,
		opts: { includeInactiveVariants?: boolean } = {},
	): Promise<LaserProductVariant[]> {
		let query = supabase
			.from('pl_laser_product_variant')
			.select('*')
			.eq('productId', productId)
			.order('order', { ascending: true });

		if (!opts.includeInactiveVariants) {
			query = query.eq('status', 'ativo');
		}

		const { data, error } = await query;
		if (error) throw new Error(error.message);
		return (data ?? []) as LaserProductVariant[];
	}

	async findVariantById(variantId: string): Promise<{
		variant: LaserProductVariant;
		product: LaserProduct;
	}> {
		const { data, error } = await supabase
			.from('pl_laser_product_variant')
			.select('*')
			.eq('id', variantId)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) throw new Error('Variant not found');
		const variant = data as LaserProductVariant;
		const product = await this.findById(variant.productId);
		return { variant, product };
	}

	async updateVariant(
		variantId: string,
		productId: string,
		data: UpdateLaserProductVariantInput,
	): Promise<LaserProductVariant> {
		const { data: record, error } = await supabase
			.from('pl_laser_product_variant')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', variantId)
			.eq('productId', productId)
			.select()
			.single();
		if (error || !record) throw new Error('Variant not found');
		return record as LaserProductVariant;
	}

	async deleteVariant(
		variantId: string,
		productId: string,
	): Promise<{ imageUrl: string }> {
		const { data: existing, error: findErr } = await supabase
			.from('pl_laser_product_variant')
			.select('imageUrl')
			.eq('id', variantId)
			.eq('productId', productId)
			.maybeSingle();
		if (findErr) throw new Error(findErr.message);
		if (!existing) throw new Error('Variant not found');

		const { error } = await supabase
			.from('pl_laser_product_variant')
			.delete()
			.eq('id', variantId)
			.eq('productId', productId);
		if (error) throw new Error(error.message);
		return { imageUrl: (existing as { imageUrl: string }).imageUrl };
	}
}

export const laserProductRepository = new LaserProductRepository();
