import { stripe } from '../lib/stripe.js';
import { supabase } from '../lib/supabase.js';
import type { ProductCreate } from '../types/product.js';

type ProductData = Omit<ProductCreate, 'interval'> & {
	id: string;
	status: 'ativo' | 'excluido';
	slug: string;
	stripeProductId: string;
	stripePriceId: string;
};

class ProductRepository {
	async create(data: ProductData) {
		const { data: product, error } = await supabase
			.from('pl_product')
			.insert(data)
			.select()
			.single();

		if (error) {
			throw new Error(error.message);
		}

		return product;
	}

	async deleteProduct(id: string) {
		const { data: product, error: findError } = await supabase
			.from('pl_product')
			.select('stripeProductId, stripePriceId')
			.eq('id', id)
			.single();

		if (findError || !product) {
			throw new Error('Product not found');
		}

		if (product.stripePriceId) {
			await stripe.prices.update(product.stripePriceId as string, {
				active: false,
			});
		}

		if (product.stripeProductId) {
			await stripe.products.update(product.stripeProductId as string, {
				active: false,
			});
		}

		const { error: deleteError } = await supabase
			.from('pl_product')
			.delete()
			.eq('id', id);

		if (deleteError) {
			throw new Error(deleteError.message);
		}
	}

	async listActiveProducts() {
		const { data, error } = await supabase
			.from('pl_product')
			.select('*')
			.eq('status', 'ativo');

		if (error) {
			throw new Error(error.message);
		}

		return data;
	}

	async findByStripeProductId(stripeProductId: string) {
		const { data, error } = await supabase
			.from('pl_product')
			.select('name, slug')
			.eq('stripeProductId', stripeProductId)
			.single();

		if (error) {
			throw new Error(error.message);
		}

		return data;
	}

	async findBySlug(slug: string) {
		const { data, error } = await supabase
			.from('pl_product')
			.select('*')
			.eq('slug', slug)
			.eq('status', 'ativo')
			.single();

		if (error) throw new Error('Product not found');
		return data;
	}
}

export const productRepository = new ProductRepository();
