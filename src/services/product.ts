import { stripe } from '../lib/stripe.js';
import { lessonRepository } from '../repositories/lesson.js';
import { moduleRepository } from '../repositories/module.js';
import { productRepository } from '../repositories/product.js';
import type { ProductCreate } from '../types/product.js';

export class ProductService {
	async listProducts() {
		return await productRepository.listActiveProducts();
	}

	async getCourseContent(slug: string) {
		const product = await productRepository.findBySlug(slug);
		const modules = await moduleRepository.listByProduct(product.id);
		const lessons = await lessonRepository.listByProduct(product.id);

		return {
			id: product.id,
			name: product.name,
			description: product.description,
			image: product.image,
			slug: product.slug,
			modules: modules.map((mod) => ({
				id: mod.id,
				title: mod.title,
				description: mod.description,
				order: mod.order,
				lessons: lessons.filter((l) => l.moduleId === mod.id),
			})),
		};
	}

	async deleteProduct(id: string) {
		return await productRepository.deleteProduct(id);
	}

	async updateProductStatus(id: string, active: boolean) {
		return await productRepository.updateStatus(id, active);
	}

	async createProduct(data: ProductCreate) {
		const stripeProduct = await stripe.products.create({
			name: data.name,
			description: data.description || undefined,
		});

		const stripePrice = await stripe.prices.create({
			product: stripeProduct.id,
			unit_amount: Math.round(data.price * 100),
			currency: 'brl',
			recurring:
				data.interval !== 'one_time'
					? { interval: data.interval as 'month' | 'year' }
					: undefined,
		});

		const slug =
			data.slug ??
			data.name
				.toLowerCase()
				.normalize('NFD')
				.replace(/[\u0300-\u036f]/g, '')
				.replace(/\s+/g, '-')
				.replace(/[^a-z0-9-]/g, '');

		const product = await productRepository.create({
			id: crypto.randomUUID(),
			name: data.name,
			type: data.type,
			description: data.description,
			image: data.image,
			price: data.price,
			status: 'ativo',
			slug,
			language: data.language,
			country: data.country,
			category: data.category,
			refundDays: data.refundDays,
			stripeProductId: stripeProduct.id,
			stripePriceId: stripePrice.id,
		});

		return product;
	}

	async createCoupon(data: {
		product_id: string;
		percent_off?: number;
		amount_off?: number;
		duration: 'once' | 'repeating' | 'forever';
		duration_in_months?: number;
		max_redemptions?: number;
		redeem_by?: string;
	}) {
		const coupon = await stripe.coupons.create({
			percent_off: data.percent_off,
			amount_off: data.amount_off,
			currency: data.amount_off ? 'brl' : undefined,
			duration: data.duration,
			duration_in_months:
				data.duration === 'repeating' ? data.duration_in_months : undefined,
			max_redemptions: data.max_redemptions,
			redeem_by: data.redeem_by
				? Math.floor(new Date(data.redeem_by).getTime() / 1000)
				: undefined,
			applies_to: { products: [data.product_id] },
		});

		return {
			id: coupon.id,
			percent_off: coupon.percent_off,
			amount_off: coupon.amount_off,
			currency: coupon.currency,
			duration: coupon.duration,
			duration_in_months: coupon.duration_in_months,
			max_redemptions: coupon.max_redemptions,
			redeem_by: coupon.redeem_by,
			product_id: data.product_id,
		};
	}

	async listCouponsByProduct(productId: string) {
		const allCoupons = await stripe.coupons.list({ limit: 100 });

		const filtered = allCoupons.data.filter((coupon) =>
			coupon.applies_to?.products?.includes(productId),
		);

		if (!filtered.length) return [];

		return filtered.map((coupon) => ({
			id: coupon.id,
			percent_off: coupon.percent_off,
			amount_off: coupon.amount_off,
			currency: coupon.currency,
			duration: coupon.duration,
			duration_in_months: coupon.duration_in_months,
			max_redemptions: coupon.max_redemptions,
			redeem_by: coupon.redeem_by,
			times_redeemed: coupon.times_redeemed,
			valid: coupon.valid,
			product_id: productId,
		}));
	}

	async deleteCoupon(couponId: string) {
		return await stripe.coupons.del(couponId);
	}
}

export const productService = new ProductService();
