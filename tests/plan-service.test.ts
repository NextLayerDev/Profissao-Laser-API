import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../src/lib/stripe.js', () => ({
	stripe: {
		products: { create: vi.fn(), update: vi.fn() },
		prices: { create: vi.fn(), update: vi.fn() },
	},
}));

vi.mock('../src/repositories/plan.js', () => ({
	planRepository: {
		create: vi.fn(),
		listAll: vi.fn(),
		findById: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		addCurso: vi.fn(),
		removeCurso: vi.fn(),
	},
}));

import { stripe } from '../src/lib/stripe.js';
import { planRepository } from '../src/repositories/plan.js';
import { planService } from '../src/services/plan.js';

const stripeApi = stripe as unknown as {
	products: {
		create: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
	};
	prices: {
		create: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
	};
};

const repo = planRepository as unknown as Record<
	string,
	ReturnType<typeof vi.fn>
>;

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
	cursos: [],
	...overrides,
});

// ── Testes ────────────────────────────────────────────────────────────────────

describe('planService.createPlan', () => {
	beforeEach(() => vi.clearAllMocks());

	it('cria produto e preço no Stripe e persiste o plano', async () => {
		stripeApi.products.create.mockResolvedValue({ id: 'prod_plan_new' });
		stripeApi.prices.create.mockResolvedValue({ id: 'price_plan_new' });
		repo.create.mockResolvedValue(
			makePlan({
				stripeProductId: 'prod_plan_new',
				stripePriceId: 'price_plan_new',
			}),
		);

		const { data, error } = await planService.createPlan({
			name: 'Plano Básico',
			price: 197,
			interval: 'month',
			status: 'ativo',
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

		expect(error).toBeNull();
		expect(stripeApi.products.create).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Plano Básico' }),
		);
		expect(stripeApi.prices.create).toHaveBeenCalledWith(
			expect.objectContaining({
				product: 'prod_plan_new',
				unit_amount: 19700,
				currency: 'brl',
				recurring: { interval: 'month' },
			}),
		);
		expect(repo.create).toHaveBeenCalledWith(
			expect.objectContaining({
				stripeProductId: 'prod_plan_new',
				stripePriceId: 'price_plan_new',
				aulas: true,
				previas: false,
			}),
		);
		expect(data?.stripeProductId).toBe('prod_plan_new');
	});

	it('cria plano sem recorrência quando interval é one_time', async () => {
		stripeApi.products.create.mockResolvedValue({ id: 'prod_x' });
		stripeApi.prices.create.mockResolvedValue({ id: 'price_x' });
		repo.create.mockResolvedValue(makePlan());

		await planService.createPlan({
			name: 'Plano Único',
			price: 997,
			interval: 'one_time',
			status: 'ativo',
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

		expect(stripeApi.prices.create).toHaveBeenCalledWith(
			expect.objectContaining({ recurring: undefined }),
		);
	});

	it('retorna error quando Stripe falha', async () => {
		stripeApi.products.create.mockRejectedValue(new Error('Stripe error'));

		const { data, error } = await planService.createPlan({
			name: 'Falha',
			price: 197,
			interval: 'month',
			status: 'ativo',
			previas: false,
			canva: false,
			vetorizacao: false,
			parametros: false,
			fornecedores: false,
			aulas: false,
			suporte: false,
			biblioteca: false,
			comunidade: false,
		});

		expect(data).toBeNull();
		expect(error).toBeInstanceOf(Error);
	});
});

describe('planService.updatePlan', () => {
	beforeEach(() => vi.clearAllMocks());

	it('sincroniza nome com Stripe quando nome muda', async () => {
		repo.findById.mockResolvedValue(makePlan());
		repo.update.mockResolvedValue(makePlan({ name: 'Novo Nome' }));

		await planService.updatePlan('plan-uuid-1', { name: 'Novo Nome' });

		expect(stripeApi.products.update).toHaveBeenCalledWith(
			'prod_plan_abc',
			expect.objectContaining({ name: 'Novo Nome' }),
		);
	});

	it('cria novo preço no Stripe quando price muda', async () => {
		repo.findById.mockResolvedValue(makePlan());
		stripeApi.prices.update.mockResolvedValue({});
		stripeApi.prices.create.mockResolvedValue({ id: 'price_novo' });
		repo.update.mockResolvedValue(makePlan({ price: 250 }));

		await planService.updatePlan('plan-uuid-1', { price: 250 });

		expect(stripeApi.prices.update).toHaveBeenCalledWith('price_plan_abc', {
			active: false,
		});
		expect(stripeApi.prices.create).toHaveBeenCalledWith(
			expect.objectContaining({ unit_amount: 25000 }),
		);
		const callArg = repo.update.mock.calls[0][1];
		expect(callArg.stripePriceId).toBe('price_novo');
	});

	it('atualiza apenas flags sem tocar no Stripe', async () => {
		repo.findById.mockResolvedValue(makePlan());
		repo.update.mockResolvedValue(makePlan({ previas: true }));

		await planService.updatePlan('plan-uuid-1', { previas: true });

		expect(stripeApi.products.update).not.toHaveBeenCalled();
		expect(stripeApi.prices.update).not.toHaveBeenCalled();
	});
});

describe('planService.listPlans', () => {
	it('retorna lista de planos com cursos', async () => {
		repo.listAll.mockResolvedValue([makePlan()]);

		const { data, error } = await planService.listPlans();

		expect(error).toBeNull();
		expect(data).toHaveLength(1);
	});
});

describe('planService.deletePlan', () => {
	it('deleta o plano chamando o repositório', async () => {
		repo.delete.mockResolvedValue(undefined);

		const { error } = await planService.deletePlan('plan-uuid-1');

		expect(error).toBeNull();
		expect(repo.delete).toHaveBeenCalledWith('plan-uuid-1');
	});
});

describe('planService.addCurso / removeCurso', () => {
	beforeEach(() => vi.clearAllMocks());

	it('addCurso: chama repositório com planId e cursoId', async () => {
		repo.addCurso.mockResolvedValue(undefined);

		const { error } = await planService.addCurso('plan-uuid-1', 'curso-1');

		expect(error).toBeNull();
		expect(repo.addCurso).toHaveBeenCalledWith('plan-uuid-1', 'curso-1');
	});

	it('removeCurso: chama repositório com planId e cursoId', async () => {
		repo.removeCurso.mockResolvedValue(undefined);

		const { error } = await planService.removeCurso('plan-uuid-1', 'curso-1');

		expect(error).toBeNull();
		expect(repo.removeCurso).toHaveBeenCalledWith('plan-uuid-1', 'curso-1');
	});

	it('removeCurso: propaga erro do repositório', async () => {
		repo.removeCurso.mockRejectedValue(new Error('Curso not in plan'));

		const { error } = await planService.removeCurso('plan-uuid-1', 'x');

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe('Curso not in plan');
	});
});
