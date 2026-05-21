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
		subscriptions: { list: vi.fn().mockResolvedValue({ data: [] }) },
	},
}));

import { stripe } from '../src/lib/stripe.js';
import { cursoRepository } from '../src/repositories/curso.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeCurso = (overrides = {}) => ({
	id: 'curso-1',
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

/** Monta uma chain de Supabase fluente que resolve com { data, error } */
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
	// Métodos terminais que resolvem a Promise
	(chain.single as ReturnType<typeof vi.fn>).mockResolvedValue(resolveWith);
	(chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue(
		resolveWith,
	);
	// listAll usa .select().in().order() — order é o terminal
	(chain.order as ReturnType<typeof vi.fn>).mockResolvedValue(resolveWith);
	return chain;
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('cursoRepository.listAll', () => {
	it('retorna cursos mapeando status ativo e inativo', async () => {
		const curso = makeCurso();
		const chain = makeChain({ data: [curso], error: null });
		mockFrom.mockReturnValue(chain);

		const result = await cursoRepository.listAll();

		expect(mockFrom).toHaveBeenCalledWith('pl_curso');
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('curso-1');
	});

	it('lança erro quando Supabase retorna error', async () => {
		const chain = makeChain({ data: null, error: { message: 'DB error' } });
		mockFrom.mockReturnValue(chain);

		await expect(cursoRepository.listAll()).rejects.toThrow('DB error');
	});
});

describe('cursoRepository.findById', () => {
	it('retorna o curso encontrado', async () => {
		const curso = makeCurso();
		const chain = makeChain({ data: curso, error: null });
		mockFrom.mockReturnValue(chain);

		const result = await cursoRepository.findById('curso-1');
		expect(result.id).toBe('curso-1');
	});

	it('lança "Curso not found" quando não existe', async () => {
		const chain = makeChain({ data: null, error: { message: 'not found' } });
		mockFrom.mockReturnValue(chain);

		await expect(cursoRepository.findById('x')).rejects.toThrow(
			'Curso not found',
		);
	});
});

describe('cursoRepository.create', () => {
	it('insere o curso e retorna o registro criado', async () => {
		const curso = makeCurso();
		const chain = makeChain({ data: curso, error: null });
		mockFrom.mockReturnValue(chain);

		const result = await cursoRepository.create({
			id: 'curso-1',
			name: 'Laser Básico',
			price: 297,
			status: 'ativo',
			slug: 'laser-basico-abc123',
			stripeProductId: 'prod_abc',
			stripePriceId: 'price_abc',
			aulas: true,
			suporte: false,
			biblioteca: false,
		});

		expect(mockFrom).toHaveBeenCalledWith('pl_curso');
		expect(result.id).toBe('curso-1');
	});
});

describe('cursoRepository.updateStatus', () => {
	beforeEach(() => vi.clearAllMocks());

	it('desativa no Stripe e atualiza status para inativo', async () => {
		const stripeApi = stripe as unknown as Record<
			string,
			Record<string, ReturnType<typeof vi.fn>>
		>;

		// 1ª chamada: findById para pegar stripeIds
		const findChain = makeChain({
			data: { stripeProductId: 'prod_abc', stripePriceId: 'price_abc' },
			error: null,
		});
		// 2ª chamada: update do status
		const updateChain = makeChain({
			data: makeCurso({ status: 'inativo' }),
			error: null,
		});
		mockFrom.mockReturnValueOnce(findChain).mockReturnValueOnce(updateChain);

		await cursoRepository.updateStatus('curso-1', false);

		expect(stripeApi.products.update).toHaveBeenCalledWith('prod_abc', {
			active: false,
		});
		expect(stripeApi.prices.update).toHaveBeenCalledWith(
			'price_abc',
			expect.any(Object),
		);
	});
});

describe('cursoRepository.delete', () => {
	it('lança "Curso not found" quando o curso não existe', async () => {
		const chain = makeChain({ data: null, error: { message: 'not found' } });
		mockFrom.mockReturnValue(chain);

		await expect(cursoRepository.delete('nao-existe')).rejects.toThrow(
			'Curso not found',
		);
	});

	it('deleta o curso quando existe', async () => {
		const findChain = makeChain({
			data: {
				id: 'curso-1',
				stripeProductId: 'prod_abc',
				stripePriceId: 'price_abc',
			},
			error: null,
		});
		const deleteChain = makeChain({ data: null, error: null });
		mockFrom.mockReturnValueOnce(findChain).mockReturnValueOnce(deleteChain);

		await expect(cursoRepository.delete('curso-1')).resolves.toBeUndefined();
	});
});
