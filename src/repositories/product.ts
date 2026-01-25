import { stripe } from '../lib/stripe.js';
import { supabase } from '../lib/supabase.js';

type ProductData = {
	name: string;
	description?: string;
	stripe_product_id: string;
	stripe_price_ids: string[]; // Changed to array
};
class ProductRepository {
	async create(data: ProductData) {
		const { data: product, error } = await supabase
			.from('Catalog')
			.insert(data)
			.select()
			.single();

		if (error) {
			throw new Error(error.message);
		}

		return product;
	}

	async listActiveProducts() {
		const [products, prices] = await Promise.all([
			stripe.products.list({ active: true }),
			stripe.prices.list({ active: true, limit: 100 }),
		]);

		return products.data.map((product) => {
			const productPrices = prices.data.filter(
				(price) => price.product === product.id,
			);

			const monthlyPrice = productPrices.find(
				(price) =>
					price.type === 'recurring' && price.recurring?.interval === 'month',
			);
			const annualPrice = productPrices.find(
				(price) =>
					price.type === 'recurring' && price.recurring?.interval === 'year',
			);
			const lifetimePrice = productPrices.find(
				(price) => price.type === 'one_time',
			);

			return {
				id: product.id,
				name: product.name,
				description: product.description,
				image: product.images[0] || null,
				prices: {
					monthly: monthlyPrice?.unit_amount
						? monthlyPrice.unit_amount / 100
						: null,
					annual: annualPrice?.unit_amount
						? annualPrice.unit_amount / 100
						: null,
					lifetime: lifetimePrice?.unit_amount
						? lifetimePrice.unit_amount / 100
						: null,
				},
				currency:
					monthlyPrice?.currency ||
					annualPrice?.currency ||
					lifetimePrice?.currency ||
					'brl',
			};
		});
	}
}

export const productRepository = new ProductRepository();
