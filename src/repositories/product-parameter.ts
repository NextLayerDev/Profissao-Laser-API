import { supabase } from '../lib/supabase.js';
import type {
	ProductParameter,
	UpdateProductParameterInput,
} from '../types/product-parameter.js';

interface CreateRow {
	id: string;
	productId: string;
	machineId: string;
	parameterId: string;
	powerOptionId: string | null;
	lensOptionId: string | null;
	softwareOptionId: string | null;
	axisOptionId: string | null;
	operationOptionId: string | null;
	variantId: string | null;
	lessonId: string | null;
}

class ProductParameterRepository {
	async create(data: CreateRow): Promise<ProductParameter> {
		const { data: record, error } = await supabase
			.from('pl_product_parameter')
			.insert(data)
			.select()
			.single();
		if (error || !record) {
			throw new Error(error?.message ?? 'Failed to create product parameter');
		}
		return record as ProductParameter;
	}

	async listByProduct(productId: string): Promise<ProductParameter[]> {
		const { data, error } = await supabase
			.from('pl_product_parameter')
			.select('*')
			.eq('productId', productId)
			.order('createdAt', { ascending: false });
		if (error) throw new Error(error.message);
		return (data ?? []) as ProductParameter[];
	}

	async listByProductAndMachine(
		productId: string,
		machineId: string,
	): Promise<ProductParameter[]> {
		const { data, error } = await supabase
			.from('pl_product_parameter')
			.select('*')
			.eq('productId', productId)
			.eq('machineId', machineId);
		if (error) throw new Error(error.message);
		return (data ?? []) as ProductParameter[];
	}

	async findByIdAndProduct(
		id: string,
		productId: string,
	): Promise<ProductParameter> {
		const { data, error } = await supabase
			.from('pl_product_parameter')
			.select('*')
			.eq('id', id)
			.eq('productId', productId)
			.maybeSingle();
		if (error) throw new Error(error.message);
		if (!data) throw new Error('Product parameter not found');
		return data as ProductParameter;
	}

	async update(
		id: string,
		productId: string,
		data: UpdateProductParameterInput,
	): Promise<ProductParameter> {
		const { data: record, error } = await supabase
			.from('pl_product_parameter')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.eq('productId', productId)
			.select()
			.single();
		if (error || !record) throw new Error('Product parameter not found');
		return record as ProductParameter;
	}

	async delete(id: string, productId: string): Promise<void> {
		const { data: existing, error: findError } = await supabase
			.from('pl_product_parameter')
			.select('id')
			.eq('id', id)
			.eq('productId', productId)
			.maybeSingle();
		if (findError) throw new Error(findError.message);
		if (!existing) throw new Error('Product parameter not found');

		const { error } = await supabase
			.from('pl_product_parameter')
			.delete()
			.eq('id', id)
			.eq('productId', productId);
		if (error) throw new Error(error.message);
	}
}

export const productParameterRepository = new ProductParameterRepository();
