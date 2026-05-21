import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../src/lib/stripe.js', () => ({
	stripe: {
		products: { create: vi.fn(), update: vi.fn() },
		prices: { create: vi.fn(), update: vi.fn() },
	},
}));

vi.mock('../src/repositories/curso.js', () => ({
	cursoRepository: {
		create: vi.fn(),
		listAll: vi.fn(),
		findById: vi.fn(),
		update: vi.fn(),
		updateStatus: vi.fn(),
		updateImage: vi.fn(),
		delete: vi.fn(),
	},
}));

import { stripe } from '../src/lib/stripe.js';
import { cursoRepository } from '../src/repositories/curso.js';
import { cursoService } from '../src/services/curso.js';

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

const repo = cursoRepository as unknown as Record<
	string,
	ReturnType<typeof vi.fn>
>;

const makeCurso = (overrides = {}) => ({
	id: 'curso-abc123',
	name: 'Laser Básico',
	description: null,
	image: null,
	slug: 'laser-basico-abc123',
	status: 'ativo',
	price: 297,
	stripeProductId: 'prod_abc',
	stripePriceId: 'price_abc',
	aulas: true,
	suporte: false,
	biblioteca: false,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
});

// ── Testes ────────────────────────────────────────────────────────────────────

describe('cursoService.createCurso', () => {
	beforeEach(() => vi.clearAllMocks());

	it('cria produto e preço no Stripe e persiste o curso', async () => {
		stripeApi.products.create.mockResolvedValue({ id: 'prod_new' });
		stripeApi.prices.create.mockResolvedValue({ id: 'price_new' });
		repo.create.mockResolvedValue(
			makeCurso({ stripeProductId: 'prod_new', stripePriceId: 'price_new' }),
		);

		const { data, error } = await cursoService.createCurso({
			name: 'Laser Básico',
			price: 297,
			aulas: true,
			suporte: false,
			biblioteca: false,
			interval: 'one_time',
		});

		expect(error).toBeNull();
		expect(stripeApi.products.create).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Laser Básico' }),
		);
		expect(stripeApi.prices.create).toHaveBeenCalledWith(
			expect.objectContaining({
				product: 'prod_new',
				unit_amount: 29700,
				currency: 'brl',
			}),
		);
		expect(repo.create).toHaveBeenCalledWith(
			expect.objectContaining({
				stripeProductId: 'prod_new',
				stripePriceId: 'price_new',
				aulas: true,
				suporte: false,
				biblioteca: false,
			}),
		);
		expect(data?.stripeProductId).toBe('prod_new');
	});

	it('gera slug a partir do nome quando slug não é fornecido', async () => {
		stripeApi.products.create.mockResolvedValue({ id: 'prod_x' });
		stripeApi.prices.create.mockResolvedValue({ id: 'price_x' });
		repo.create.mockResolvedValue(makeCurso({ slug: 'laser-basico-abc123' }));

		await cursoService.createCurso({
			name: 'Laser Básico',
			price: 297,
			aulas: true,
			suporte: false,
			biblioteca: false,
			interval: 'one_time',
		});

		const callArg = repo.create.mock.calls[0][0];
		expect(callArg.slug).toMatch(/^laser-basico-/);
	});

	it('usa slug personalizado quando fornecido', async () => {
		stripeApi.products.create.mockResolvedValue({ id: 'prod_x' });
		stripeApi.prices.create.mockResolvedValue({ id: 'price_x' });
		repo.create.mockResolvedValue(makeCurso({ slug: 'meu-slug-abc123' }));

		await cursoService.createCurso({
			name: 'Laser Básico',
			price: 297,
			slug: 'meu-slug',
			aulas: true,
			suporte: false,
			biblioteca: false,
			interval: 'one_time',
		});

		const callArg = repo.create.mock.calls[0][0];
		expect(callArg.slug).toMatch(/^meu-slug-/);
	});

	it('cria preço recorrente mensal quando interval é month', async () => {
		stripeApi.products.create.mockResolvedValue({ id: 'prod_y' });
		stripeApi.prices.create.mockResolvedValue({ id: 'price_y' });
		repo.create.mockResolvedValue(makeCurso());

		await cursoService.createCurso({
			name: 'Curso Mensal',
			price: 99,
			interval: 'month',
			aulas: true,
			suporte: false,
			biblioteca: false,
		});

		expect(stripeApi.prices.create).toHaveBeenCalledWith(
			expect.objectContaining({
				recurring: { interval: 'month' },
			}),
		);
	});

	it('retorna error quando Stripe falha', async () => {
		stripeApi.products.create.mockRejectedValue(new Error('Stripe down'));

		const { data, error } = await cursoService.createCurso({
			name: 'Falha',
			price: 99,
			aulas: true,
			suporte: false,
			biblioteca: false,
			interval: 'one_time',
		});

		expect(data).toBeNull();
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe('Stripe down');
	});
});

describe('cursoService.updateCurso', () => {
	beforeEach(() => vi.clearAllMocks());

	it('sincroniza nome com Stripe quando nome muda', async () => {
		repo.findById.mockResolvedValue(makeCurso());
		repo.update.mockResolvedValue(makeCurso({ name: 'Novo Nome' }));

		await cursoService.updateCurso('curso-abc123', { name: 'Novo Nome' });

		expect(stripeApi.products.update).toHaveBeenCalledWith(
			'prod_abc',
			expect.objectContaining({ name: 'Novo Nome' }),
		);
	});

	it('cria novo preço no Stripe quando price muda', async () => {
		repo.findById.mockResolvedValue(makeCurso());
		stripeApi.prices.update.mockResolvedValue({});
		stripeApi.prices.create.mockResolvedValue({ id: 'price_novo' });
		repo.update.mockResolvedValue(makeCurso({ price: 350 }));

		await cursoService.updateCurso('curso-abc123', { price: 350 });

		expect(stripeApi.prices.update).toHaveBeenCalledWith('price_abc', {
			active: false,
		});
		expect(stripeApi.prices.create).toHaveBeenCalledWith(
			expect.objectContaining({ unit_amount: 35000 }),
		);
		const callArg = repo.update.mock.calls[0][1];
		expect(callArg.stripePriceId).toBe('price_novo');
	});

	it('retorna error quando curso não existe', async () => {
		repo.findById.mockRejectedValue(new Error('Curso not found'));

		const { error } = await cursoService.updateCurso('x', { name: 'Teste' });

		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe('Curso not found');
	});
});

describe('cursoService.listCursos', () => {
	it('retorna a lista de cursos', async () => {
		repo.listAll.mockResolvedValue([makeCurso()]);

		const { data, error } = await cursoService.listCursos();

		expect(error).toBeNull();
		expect(data).toHaveLength(1);
	});
});

describe('cursoService.deleteCurso', () => {
	it('deleta o curso chamando o repositório', async () => {
		repo.delete.mockResolvedValue(undefined);

		const { error } = await cursoService.deleteCurso('curso-abc123');

		expect(error).toBeNull();
		expect(repo.delete).toHaveBeenCalledWith('curso-abc123');
	});
});

describe('cursoService.updateCursoStatus', () => {
	it('chama updateStatus no repositório', async () => {
		repo.updateStatus.mockResolvedValue(makeCurso({ status: 'inativo' }));

		const { data, error } = await cursoService.updateCursoStatus(
			'curso-abc123',
			false,
		);

		expect(error).toBeNull();
		expect(repo.updateStatus).toHaveBeenCalledWith('curso-abc123', false);
		expect(data?.status).toBe('inativo');
	});
});
