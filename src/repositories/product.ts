import { stripe } from '../lib/stripe.js';
import { supabase } from '../lib/supabase.js';
import type { ProductCreate } from '../types/product.js';

type ProductData = Omit<ProductCreate, 'interval'> & {
	id: string;
	status: 'ativo' | 'excluido' | 'inativo';
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

	async listAllProducts() {
		const { data, error } = await supabase
			.from('pl_product')
			.select('*')
			.in('status', ['ativo', 'inativo']);

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
			.eq('status', 'ativo')
			.limit(1)
			.maybeSingle();

		if (error) {
			throw new Error(error.message);
		}

		return data;
	}

	async findById(id: string) {
		const { data, error } = await supabase
			.from('pl_product')
			.select('*')
			.eq('id', id)
			.eq('status', 'ativo')
			.single();

		if (error || !data) throw new Error('Product not found');
		return data;
	}

	async updateStatus(id: string, active: boolean) {
		const { data: product, error: findError } = await supabase
			.from('pl_product')
			.select('stripeProductId')
			.eq('id', id)
			.neq('status', 'excluido')
			.single();

		if (findError || !product) {
			throw new Error('Product not found');
		}

		if (product.stripeProductId) {
			await stripe.products.update(product.stripeProductId as string, {
				active,
			});
		}

		const { data, error } = await supabase
			.from('pl_product')
			.update({ status: active ? 'ativo' : 'inativo' })
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
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
