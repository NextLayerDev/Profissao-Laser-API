import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock('../src/lib/supabase.js', () => ({
	supabase: { from: mockFrom },
}));

vi.mock('../src/lib/stripe.js', () => ({
	stripe: {
		products: { update: vi.fn() },
		prices: { update: vi.fn() },
	},
}));

import { planRepository } from '../src/repositories/plan.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makePlan = (overrides = {}) => ({
	id: 'plan-uuid-1',
	name: 'Plano Básico',
	description: null,
	status: 'ativo',
	price: 197,
	stripeProductId: 'prod_plan_abc',
	stripePriceId: 'price_plan_abc',
	previas: false,
	canva: false,
	vetorizacao: false,
	parametros: false,
	fornecedores: false,
	aulas: true,
	suporte: false,
	biblioteca: false,
	comunidade: false,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
});

const makeCurso = () => ({
	id: 'curso-1',
	name: 'Laser Básico',
	description: null,
	image: null,
	slug: 'laser-basico',
	status: 'ativo',
	price: 297,
	stripeProductId: 'prod_abc',
	stripePriceId: 'price_abc',
	aulas: true,
	suporte: false,
	biblioteca: false,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
});

function makeChain(resolveWith: { data: unknown; error: unknown }) {
	const chain: Record<string, unknown> = {};
	const methods = [
		'select',
		'insert',
		'update',
		'delete',
		'eq',
		'neq',
		'in',
		'single',
		'maybeSingle',
		'limit',
		'order',
	];
	for (const m of methods) {
		chain[m] = vi.fn().mockReturnValue(chain);
	}
	(chain.single as ReturnType<typeof vi.fn>).mockResolvedValue(resolveWith);
	(chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue(
		resolveWith,
	);
	(chain.order as ReturnType<typeof vi.fn>).mockResolvedValue(resolveWith);
	(chain.in as ReturnType<typeof vi.fn>).mockResolvedValue(resolveWith);
	return chain;
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('planRepository.listAll', () => {
	beforeEach(() => vi.clearAllMocks());

	it('retorna planos com seus cursos mapeados', async () => {
		const rawPlan = {
			...makePlan(),
			pl_plan_curso: [{ pl_curso: makeCurso() }],
		};
		const chain = makeChain({ data: [rawPlan], error: null });
		mockFrom.mockReturnValue(chain);

		const result = await planRepository.listAll();

		expect(mockFrom).toHaveBeenCalledWith('pl_plan');
		expect(result).toHaveLength(1);
		expect(result[0].cursos).toHaveLength(1);
		expect(result[0].cursos[0].id).toBe('curso-1');
	});

	it('lança erro quando Supabase retorna error', async () => {
		const chain = makeChain({ data: null, error: { message: 'DB error' } });
		mockFrom.mockReturnValue(chain);

		await expect(planRepository.listAll()).rejects.toThrow('DB error');
	});
});

describe('planRepository.findById', () => {
	it('retorna o plano com cursos', async () => {
		const rawPlan = {
			...makePlan(),
			pl_plan_curso: [{ pl_curso: makeCurso() }],
		};
		const chain = makeChain({ data: rawPlan, error: null });
		mockFrom.mockReturnValue(chain);

		const result = await planRepository.findById('plan-uuid-1');
		expect(result.id).toBe('plan-uuid-1');
		expect(result.cursos).toHaveLength(1);
	});

	it('lança "Plan not found" quando não existe', async () => {
		const chain = makeChain({ data: null, error: { message: 'not found' } });
		mockFrom.mockReturnValue(chain);

		await expect(planRepository.findById('x')).rejects.toThrow(
			'Plan not found',
		);
	});
});

describe('planRepository.create', () => {
	it('insere o plano e retorna o registro criado', async () => {
		const plan = makePlan();
		const chain = makeChain({ data: plan, error: null });
		mockFrom.mockReturnValue(chain);

		const result = await planRepository.create({
			name: 'Plano Básico',
			status: 'ativo',
			price: 197,
			stripeProductId: 'prod_plan_abc',
			stripePriceId: 'price_plan_abc',
			previas: false,
			canva: false,
			vetorizacao: false,
			parametros: false,
			fornecedores: false,
			aulas: true,
			suporte: false,
			biblioteca: false,
			comunidade: false,
		});

		expect(mockFrom).toHaveBeenCalledWith('pl_plan');
		expect(result.name).toBe('Plano Básico');
	});
});

describe('planRepository.update', () => {
	it('lança "Plan not found" se o plano não existe', async () => {
		const chain = makeChain({ data: null, error: { message: 'not found' } });
		mockFrom.mockReturnValue(chain);

		await expect(planRepository.update('x', { name: 'novo' })).rejects.toThrow(
			'Plan not found',
		);
	});

	it('atualiza e retorna o plano', async () => {
		const findChain = makeChain({ data: { id: 'plan-uuid-1' }, error: null });
		const updateChain = makeChain({
			data: makePlan({ name: 'Plano Atualizado' }),
			error: null,
		});
		mockFrom.mockReturnValueOnce(findChain).mockReturnValueOnce(updateChain);

		const result = await planRepository.update('plan-uuid-1', {
			name: 'Plano Atualizado',
		});
		expect(result.name).toBe('Plano Atualizado');
	});
});

describe('planRepository.addCurso / removeCurso', () => {
	beforeEach(() => vi.clearAllMocks());

	it('addCurso: lança "Plan not found" quando plano não existe', async () => {
		const chain = makeChain({ data: null, error: { message: 'not found' } });
		mockFrom.mockReturnValue(chain);

		await expect(planRepository.addCurso('plan-x', 'curso-1')).rejects.toThrow(
			'Plan not found',
		);
	});

	it('addCurso: insere na junction table', async () => {
		const planChain = makeChain({ data: { id: 'plan-uuid-1' }, error: null });
		const cursoChain = makeChain({ data: { id: 'curso-1' }, error: null });
		const insertChain = makeChain({ data: null, error: null });
		mockFrom
			.mockReturnValueOnce(planChain)
			.mockReturnValueOnce(cursoChain)
			.mockReturnValueOnce(insertChain);

		await expect(
			planRepository.addCurso('plan-uuid-1', 'curso-1'),
		).resolves.toBeUndefined();
	});

	it('removeCurso: lança "Curso not in plan" quando relação não existe', async () => {
		const chain = makeChain({ data: null, error: { message: 'not found' } });
		mockFrom.mockReturnValue(chain);

		await expect(
			planRepository.removeCurso('plan-uuid-1', 'curso-1'),
		).rejects.toThrow('Curso not in plan');
	});
});

describe('planRepository.delete', () => {
	it('lança "Plan not found" quando plano não existe', async () => {
		const chain = makeChain({ data: null, error: { message: 'not found' } });
		mockFrom.mockReturnValue(chain);

		await expect(planRepository.delete('nao-existe')).rejects.toThrow(
			'Plan not found',
		);
	});

	it('deleta o plano quando existe', async () => {
		const findChain = makeChain({ data: { id: 'plan-uuid-1' }, error: null });
		const deleteChain = makeChain({ data: null, error: null });
		mockFrom.mockReturnValueOnce(findChain).mockReturnValueOnce(deleteChain);

		await expect(planRepository.delete('plan-uuid-1')).resolves.toBeUndefined();
	});
});
