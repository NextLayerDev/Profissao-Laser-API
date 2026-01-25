import { stripe } from '../lib/stripe.js';
import { productRepository } from '../repositories/product.js';

type CreateProductData = {
	name: string;
	description?: string;
	prices: Array<{ amount: number; interval: 'month' | 'year' | 'one_time' }>;
};
export class ProductService {
	async listProducts() {
		return await productRepository.listActiveProducts();
	}

	async createProduct({ name, description, prices }: CreateProductData) {
		const stripeProduct = await stripe.products.create({
			name,
			description: description ?? undefined,
		});

		const stripePriceIds: string[] = [];
		for (const priceData of prices) {
			const stripePrice = await stripe.prices.create({
				product: stripeProduct.id,
				unit_amount: priceData.amount,
				currency: 'brl', // Assuming 'brl' as default currency
				recurring:
					priceData.interval !== 'one_time'
						? { interval: priceData.interval }
						: undefined,
			});
			stripePriceIds.push(stripePrice.id);
		}

		const product = await productRepository.create({
			name,
			description,
			stripe_product_id: stripeProduct.id,
			stripe_price_ids: stripePriceIds,
		});

		return product;
	}
}

export const productService = new ProductService();
