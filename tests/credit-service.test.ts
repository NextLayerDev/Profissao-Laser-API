import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/stripe.js', () => ({
	stripe: {
		checkout: { sessions: { create: vi.fn() } },
		products: { create: vi.fn(), update: vi.fn() },
		prices: { create: vi.fn() },
	},
}));

vi.mock('../src/repositories/credit.js', () => ({
	creditRepository: {
		getFeatureCost: vi.fn(),
		getBalance: vi.fn(),
		consume: vi.fn(),
		refund: vi.fn(),
		findPackageById: vi.fn(),
		addCredits: vi.fn(),
	},
}));

import {
	CreditConfirmationRequiredError,
	InsufficientCreditsError,
} from '../src/lib/credit-errors.js';
import { creditRepository } from '../src/repositories/credit.js';
import { creditService } from '../src/services/credit.js';

const repo = creditRepository as unknown as {
	getFeatureCost: ReturnType<typeof vi.fn>;
	getBalance: ReturnType<typeof vi.fn>;
	consume: ReturnType<typeof vi.fn>;
	refund: ReturnType<typeof vi.fn>;
};

describe('creditService.fulfillPurchase', () => {
	it('credita pelo pacote resolvido do metadata', async () => {
		const r = creditRepository as unknown as Record<
			string,
			ReturnType<typeof vi.fn>
		>;
		r.findPackageById = vi.fn().mockResolvedValue({ id: 'p1', credits: 50 });
		r.addCredits = vi.fn().mockResolvedValue(50);

		const balance = await creditService.fulfillPurchase({
			id: 'sess_1',
			metadata: {
				type: 'credit_purchase',
				customer_id: 'c1',
				package_id: 'p1',
			},
		} as never);

		expect(r.findPackageById).toHaveBeenCalledWith('p1');
		expect(r.addCredits).toHaveBeenCalledWith({
			customerId: 'c1',
			amount: 50,
			packageId: 'p1',
			stripeSessionId: 'sess_1',
		});
		expect(balance).toBe(50);
	});
});

describe('creditService.charge', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		repo.getFeatureCost.mockResolvedValue(2);
		repo.getBalance.mockResolvedValue(5);
		repo.consume.mockResolvedValue(3);
		repo.refund.mockResolvedValue(5);
	});

	it('lança CreditConfirmationRequiredError sem confirmação', async () => {
		await expect(
			creditService.charge({
				customerId: 'c1',
				feature: 'vectorize',
				idempotencyKey: 'k1',
				confirmed: false,
			}),
		).rejects.toBeInstanceOf(CreditConfirmationRequiredError);
		expect(repo.consume).not.toHaveBeenCalled();
	});

	it('lança InsufficientCreditsError quando saldo < custo', async () => {
		repo.getBalance.mockResolvedValue(1);
		await expect(
			creditService.charge({
				customerId: 'c1',
				feature: 'vectorize',
				idempotencyKey: 'k1',
				confirmed: true,
			}),
		).rejects.toBeInstanceOf(InsufficientCreditsError);
		expect(repo.consume).not.toHaveBeenCalled();
	});

	it('debita quando confirmado e com saldo, e refund() estorna', async () => {
		const handle = await creditService.charge({
			customerId: 'c1',
			feature: 'vectorize',
			idempotencyKey: 'k1',
			confirmed: true,
		});
		expect(repo.consume).toHaveBeenCalledWith({
			customerId: 'c1',
			feature: 'vectorize',
			cost: 2,
			idempotencyKey: 'k1',
			metadata: {},
		});
		expect(handle.cost).toBe(2);
		expect(handle.balance).toBe(3);

		await handle.refund();
		expect(repo.refund).toHaveBeenCalledWith({
			customerId: 'c1',
			amount: 2,
			feature: 'vectorize',
			idempotencyKey: 'refund:k1',
		});
	});
});
