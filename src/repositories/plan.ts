import { supabase } from '../lib/supabase.js';

type PlanData = {
	name: string;
	description?: string | null;
	status: 'ativo' | 'inativo';
	price: number;
	stripeProductId?: string | null;
	stripePriceId?: string | null;
	previas: boolean;
	canva: boolean;
	vetorizacao: boolean;
	parametros: boolean;
	fornecedores: boolean;
	aulas: boolean;
	suporte: boolean;
	biblioteca: boolean;
	comunidade: boolean;
};

type PlanUpdate = {
	name?: string;
	description?: string;
	status?: 'ativo' | 'inativo';
	price?: number;
	stripePriceId?: string;
	previas?: boolean;
	canva?: boolean;
	vetorizacao?: boolean;
	parametros?: boolean;
	fornecedores?: boolean;
	aulas?: boolean;
	suporte?: boolean;
	biblioteca?: boolean;
	comunidade?: boolean;
};

class PlanRepository {
	async listAll() {
		const { data, error } = await supabase
			.from('pl_plan')
			.select(`
				*,
				pl_plan_curso (
					pl_curso (*)
				)
			`)
			.order('createdAt', { ascending: false });

		if (error) throw new Error(error.message);

		return data.map((plan) => ({
			...plan,
			cursos: plan.pl_plan_curso.map(
				(pc: { pl_curso: unknown }) => pc.pl_curso,
			),
			pl_plan_curso: undefined,
		}));
	}

	async findById(id: string) {
		const { data, error } = await supabase
			.from('pl_plan')
			.select(`
				*,
				pl_plan_curso (
					pl_curso (*)
				)
			`)
			.eq('id', id)
			.single();

		if (error || !data) throw new Error('Plan not found');

		return {
			...data,
			cursos: data.pl_plan_curso.map(
				(pc: { pl_curso: unknown }) => pc.pl_curso,
			),
			pl_plan_curso: undefined,
		};
	}

	async create(data: PlanData) {
		const { data: plan, error } = await supabase
			.from('pl_plan')
			.insert({
				id: crypto.randomUUID(),
				...data,
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return plan;
	}

	async update(id: string, data: PlanUpdate) {
		const { data: existing, error: findError } = await supabase
			.from('pl_plan')
			.select('id')
			.eq('id', id)
			.single();

		if (findError || !existing) throw new Error('Plan not found');

		const { data: plan, error } = await supabase
			.from('pl_plan')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
		return plan;
	}

	async delete(id: string) {
		const { data: existing, error: findError } = await supabase
			.from('pl_plan')
			.select('id')
			.eq('id', id)
			.single();

		if (findError || !existing) throw new Error('Plan not found');

		const { error } = await supabase.from('pl_plan').delete().eq('id', id);
		if (error) throw new Error(error.message);
	}

	async addCurso(planId: string, cursoId: string) {
		const { data: plan, error: planError } = await supabase
			.from('pl_plan')
			.select('id')
			.eq('id', planId)
			.single();

		if (planError || !plan) throw new Error('Plan not found');

		const { data: curso, error: cursoError } = await supabase
			.from('pl_curso')
			.select('id')
			.eq('id', cursoId)
			.single();

		if (cursoError || !curso) throw new Error('Curso not found');

		const { error } = await supabase
			.from('pl_plan_curso')
			.insert({ planId, cursoId });

		if (error) throw new Error(error.message);
	}

	async removeCurso(planId: string, cursoId: string) {
		const { data, error: findError } = await supabase
			.from('pl_plan_curso')
			.select('planId')
			.eq('planId', planId)
			.eq('cursoId', cursoId)
			.single();

		if (findError || !data) throw new Error('Curso not in plan');

		const { error } = await supabase
			.from('pl_plan_curso')
			.delete()
			.eq('planId', planId)
			.eq('cursoId', cursoId);

		if (error) throw new Error(error.message);
	}
}

export const planRepository = new PlanRepository();
