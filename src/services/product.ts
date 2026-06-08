import { withCapture } from '@/lib/sentry.js';
import { stripe } from '../lib/stripe.js';
import { lessonRepository } from '../repositories/lesson.js';
import { moduleRepository } from '../repositories/module.js';
import { productRepository } from '../repositories/product.js';
import type {
	AddonCreate,
	ProductCreate,
	ProductUpdate,
} from '../types/product.js';

export const productService = {
	async listProducts() {
		return withCapture(() => productRepository.listAllProducts());
	},

	async getCourseContent(slug: string) {
		return withCapture(async () => {
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
		});
	},

	async createProduct(data: ProductCreate) {
		return withCapture(async () => {
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

			const id = crypto.randomUUID();

			const baseSlug =
				data.slug ??
				data.name
					.toLowerCase()
					.normalize('NFD')
					.replace(/[\u0300-\u036f]/g, '')
					.replace(/\s+/g, '-')
					.replace(/[^a-z0-9-]/g, '');
			const slug = `${baseSlug}-${id.split('-')[0]}`;

			return productRepository.create({
				id,
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
		});
	},

	async createAddon(data: AddonCreate) {
		return withCapture(async () => {
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

			const id = crypto.randomUUID();
			const baseSlug = data.name
				.toLowerCase()
				.normalize('NFD')
				.replace(/[̀-ͯ]/g, '')
				.replace(/\s+/g, '-')
				.replace(/[^a-z0-9-]/g, '');
			const slug = `${baseSlug}-${id.split('-')[0]}`;

			return productRepository.create({
				id,
				name: data.name,
				type: 'addon',
				description: data.description,
				image: undefined,
				price: data.price,
				status: 'ativo',
				slug,
				language: 'pt-BR',
				country: 'BR',
				category: undefined,
				refundDays: 7,
				stripeProductId: stripeProduct.id,
				stripePriceId: stripePrice.id,
				isAddon: true,
			});
		});
	},

	async updateProduct(id: string, data: ProductUpdate) {
		return withCapture(async () => {
			const existing = await productRepository.findById(id);

			if (data.name && existing.stripeProductId) {
				await stripe.products.update(existing.stripeProductId as string, {
					name: data.name,
					...(data.description !== undefined && {
						description: data.description,
					}),
				});
			}

			let stripePriceId: string | undefined;
			if (
				data.price !== undefined &&
				existing.stripePriceId &&
				existing.stripeProductId
			) {
				await stripe.prices.update(existing.stripePriceId as string, {
					active: false,
				});

				const newPrice = await stripe.prices.create({
					product: existing.stripeProductId as string,
					unit_amount: Math.round(data.price * 100),
					currency: 'brl',
				});

				stripePriceId = newPrice.id;
			}

			return productRepository.update(id, { ...data, stripePriceId });
		});
	},

	async deleteProduct(id: string) {
		return withCapture(() => productRepository.deleteProduct(id));
	},

	async updateProductStatus(id: string, active: boolean) {
		return withCapture(() => productRepository.updateStatus(id, active));
	},

	async createCoupon(data: {
		product_id: string;
		percent_off?: number;
		amount_off?: number;
		duration: 'once' | 'repeating' | 'forever';
		duration_in_months?: number;
		max_redemptions?: number;
		redeem_by?: string;
	}) {
		return withCapture(async () => {
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
		});
	},

	async listCouponsByProduct(productId: string) {
		return withCapture(async () => {
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
		});
	},

	async deleteCoupon(couponId: string) {
		return withCapture(() => stripe.coupons.del(couponId));
	},
};
