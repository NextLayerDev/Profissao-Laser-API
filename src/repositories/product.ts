import { stripe } from '@/lib/stripe';

export async function listActiveProducts() {
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
				annual: annualPrice?.unit_amount ? annualPrice.unit_amount / 100 : null,
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
