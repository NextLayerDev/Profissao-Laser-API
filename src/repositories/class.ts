import { supabase } from '../lib/supabase.js';
import type { ClassCreate, ClassUpdate } from '../types/class.js';

class ClassRepository {
	async listAll() {
		const { data, error } = await supabase
			.from('pl_class')
			.select(`
				*,
				pl_class_product (
					pl_product (*)
				)
			`)
			.order('createdAt', { ascending: false });

		if (error) throw new Error(error.message);

		return data.map((cls) => ({
			...cls,
			products: cls.pl_class_product.map(
				(cp: { pl_product: unknown }) => cp.pl_product,
			),
			pl_class_product: undefined,
		}));
	}

	async create(data: ClassCreate) {
		const { data: cls, error } = await supabase
			.from('pl_class')
			.insert({
				id: crypto.randomUUID(),
				...data,
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return cls;
	}

	async update(id: string, data: ClassUpdate) {
		const { data: existing, error: findError } = await supabase
			.from('pl_class')
			.select('id')
			.eq('id', id)
			.single();

		if (findError || !existing) throw new Error('Class not found');

		const { data: cls, error } = await supabase
			.from('pl_class')
			.update(data)
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return cls;
	}

	async delete(id: string) {
		const { data: existing, error: findError } = await supabase
			.from('pl_class')
			.select('id')
			.eq('id', id)
			.single();

		if (findError || !existing) throw new Error('Class not found');

		const { error } = await supabase.from('pl_class').delete().eq('id', id);

		if (error) throw new Error(error.message);
	}

	async addProduct(classId: string, productId: string) {
		const { data: cls, error: classError } = await supabase
			.from('pl_class')
			.select('id')
			.eq('id', classId)
			.single();

		if (classError || !cls) throw new Error('Class not found');

		const { data: product, error: productError } = await supabase
			.from('pl_product')
			.select('id')
			.eq('id', productId)
			.single();

		if (productError || !product) throw new Error('Product not found');

		const { error } = await supabase
			.from('pl_class_product')
			.insert({ classId, productId });

		if (error) throw new Error(error.message);
	}

	async removeProduct(classId: string, productId: string) {
		const { data, error: findError } = await supabase
			.from('pl_class_product')
			.select('classId')
			.eq('classId', classId)
			.eq('productId', productId)
			.single();

		if (findError || !data) throw new Error('Product not in class');

		const { error } = await supabase
			.from('pl_class_product')
			.delete()
			.eq('classId', classId)
			.eq('productId', productId);

		if (error) throw new Error(error.message);
	}
}

export const classRepository = new ClassRepository();
