import { supabase } from '../lib/supabase.js';
import type {
	SystemClassCreate,
	SystemClassUpdate,
} from '../types/system-class.js';

class SystemClassRepository {
	async listAll() {
		const { data, error } = await supabase
			.from('pl_system_class')
			.select(`
				*,
				pl_system_class_product (
					pl_product (*)
				),
				pl_system_class_class (
					pl_class (*)
				)
			`)
			.order('createdAt', { ascending: false });

		if (error) throw new Error(error.message);

		return data.map((sc) => ({
			...sc,
			sistemaGerenciamento: sc.sistema_gerenciamento,
			iaPrevias: sc.ia_previas,
			iaWhatsappPrevias: sc.ia_whatsapp_previas,
			sistema_gerenciamento: undefined,
			ia_previas: undefined,
			ia_whatsapp_previas: undefined,
			products: sc.pl_system_class_product.map(
				(scp: { pl_product: unknown }) => scp.pl_product,
			),
			classes: sc.pl_system_class_class.map(
				(scc: { pl_class: unknown }) => scc.pl_class,
			),
			pl_system_class_product: undefined,
			pl_system_class_class: undefined,
		}));
	}

	async findById(id: string) {
		const { data, error } = await supabase
			.from('pl_system_class')
			.select(`
				*,
				pl_system_class_product (
					pl_product (*)
				),
				pl_system_class_class (
					pl_class (*)
				)
			`)
			.eq('id', id)
			.single();

		if (error || !data) throw new Error('System class not found');

		return {
			...data,
			sistemaGerenciamento: data.sistema_gerenciamento,
			iaPrevias: data.ia_previas,
			iaWhatsappPrevias: data.ia_whatsapp_previas,
			sistema_gerenciamento: undefined,
			ia_previas: undefined,
			ia_whatsapp_previas: undefined,
			products: data.pl_system_class_product.map(
				(scp: { pl_product: unknown }) => scp.pl_product,
			),
			classes: data.pl_system_class_class.map(
				(scc: { pl_class: unknown }) => scc.pl_class,
			),
			pl_system_class_product: undefined,
			pl_system_class_class: undefined,
		};
	}

	async create(data: SystemClassCreate) {
		const { data: sc, error } = await supabase
			.from('pl_system_class')
			.insert({
				id: crypto.randomUUID(),
				...data,
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return sc;
	}

	async update(id: string, data: SystemClassUpdate) {
		const { data: existing, error: findError } = await supabase
			.from('pl_system_class')
			.select('id')
			.eq('id', id)
			.single();

		if (findError || !existing) throw new Error('System class not found');

		const { data: sc, error } = await supabase
			.from('pl_system_class')
			.update(data)
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return sc;
	}

	async delete(id: string) {
		const { data: existing, error: findError } = await supabase
			.from('pl_system_class')
			.select('id')
			.eq('id', id)
			.single();

		if (findError || !existing) throw new Error('System class not found');

		const { error } = await supabase
			.from('pl_system_class')
			.delete()
			.eq('id', id);

		if (error) throw new Error(error.message);
	}

	async addProduct(systemClassId: string, productId: string) {
		const { data: sc, error: scError } = await supabase
			.from('pl_system_class')
			.select('id')
			.eq('id', systemClassId)
			.single();

		if (scError || !sc) throw new Error('System class not found');

		const { data: product, error: productError } = await supabase
			.from('pl_product')
			.select('id')
			.eq('id', productId)
			.single();

		if (productError || !product) throw new Error('Product not found');

		const { error } = await supabase
			.from('pl_system_class_product')
			.insert({ systemClassId, productId });

		if (error) throw new Error(error.message);
	}

	async removeProduct(systemClassId: string, productId: string) {
		const { data, error: findError } = await supabase
			.from('pl_system_class_product')
			.select('systemClassId')
			.eq('systemClassId', systemClassId)
			.eq('productId', productId)
			.single();

		if (findError || !data) throw new Error('Product not in system class');

		const { error } = await supabase
			.from('pl_system_class_product')
			.delete()
			.eq('systemClassId', systemClassId)
			.eq('productId', productId);

		if (error) throw new Error(error.message);
	}

	async addClass(systemClassId: string, classId: string) {
		const { data: sc, error: scError } = await supabase
			.from('pl_system_class')
			.select('id')
			.eq('id', systemClassId)
			.single();

		if (scError || !sc) throw new Error('System class not found');

		const { data: cls, error: classError } = await supabase
			.from('pl_class')
			.select('id')
			.eq('id', classId)
			.single();

		if (classError || !cls) throw new Error('Class not found');

		const { error } = await supabase
			.from('pl_system_class_class')
			.insert({ systemClassId, classId });

		if (error) throw new Error(error.message);
	}

	async removeClass(systemClassId: string, classId: string) {
		const { data, error: findError } = await supabase
			.from('pl_system_class_class')
			.select('systemClassId')
			.eq('systemClassId', systemClassId)
			.eq('classId', classId)
			.single();

		if (findError || !data) throw new Error('Class not in system class');

		const { error } = await supabase
			.from('pl_system_class_class')
			.delete()
			.eq('systemClassId', systemClassId)
			.eq('classId', classId);

		if (error) throw new Error(error.message);
	}
}

export const systemClassRepository = new SystemClassRepository();
