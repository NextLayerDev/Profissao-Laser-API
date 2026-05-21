import { stripe } from '../lib/stripe.js';
import { supabase } from '../lib/supabase.js';

type CursoData = {
	id: string;
	name: string;
	description?: string | null;
	image?: string | null;
	price: number;
	status: 'ativo' | 'inativo' | 'excluido';
	slug: string;
	stripeProductId?: string | null;
	stripePriceId?: string | null;
	aulas: boolean;
	suporte: boolean;
	biblioteca: boolean;
};

type CursoUpdate = {
	name?: string;
	description?: string;
	price?: number;
	stripePriceId?: string;
	aulas?: boolean;
	suporte?: boolean;
	biblioteca?: boolean;
};

class CursoRepository {
	async listAll() {
		const { data, error } = await supabase
			.from('pl_curso')
			.select('*')
			.in('status', ['ativo', 'inativo'])
			.order('createdAt', { ascending: false });

		if (error) throw new Error(error.message);
		return data;
	}

	async findById(id: string) {
		const { data, error } = await supabase
			.from('pl_curso')
			.select('*')
			.eq('id', id)
			.neq('status', 'excluido')
			.single();

		if (error || !data) throw new Error('Curso not found');
		return data;
	}

	async create(data: CursoData) {
		const { data: curso, error } = await supabase
			.from('pl_curso')
			.insert(data)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return curso;
	}

	async update(id: string, data: CursoUpdate) {
		const { data: curso, error } = await supabase
			.from('pl_curso')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.neq('status', 'excluido')
			.select()
			.single();

		if (error || !curso) throw new Error('Curso not found');
		return curso;
	}

	async updateImage(id: string, imageUrl: string) {
		const { data, error } = await supabase
			.from('pl_curso')
			.update({ image: imageUrl })
			.eq('id', id)
			.neq('status', 'excluido')
			.select()
			.single();

		if (error || !data) throw new Error('Curso not found');
		return data;
	}

	async updateStatus(id: string, active: boolean) {
		const { data: curso, error: findError } = await supabase
			.from('pl_curso')
			.select('stripeProductId, stripePriceId')
			.eq('id', id)
			.neq('status', 'excluido')
			.single();

		if (findError || !curso) throw new Error('Curso not found');

		if (curso.stripeProductId) {
			await stripe.products.update(curso.stripeProductId as string, { active });
		}

		if (curso.stripePriceId) {
			await stripe.prices.update(curso.stripePriceId as string, {
				active: false,
			});
		}

		const { data, error } = await supabase
			.from('pl_curso')
			.update({ status: active ? 'ativo' : 'inativo' })
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return data;
	}

	async delete(id: string) {
		const { data: existing, error: findError } = await supabase
			.from('pl_curso')
			.select('id, stripeProductId, stripePriceId')
			.eq('id', id)
			.single();

		if (findError || !existing) throw new Error('Curso not found');

		if (existing.stripePriceId) {
			await stripe.prices.update(existing.stripePriceId as string, {
				active: false,
			});
		}
		if (existing.stripeProductId) {
			await stripe.products.update(existing.stripeProductId as string, {
				active: false,
			});
		}

		const { error } = await supabase.from('pl_curso').delete().eq('id', id);

		if (error) throw new Error(error.message);
	}
}

export const cursoRepository = new CursoRepository();
