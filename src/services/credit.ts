import {
	CreditConfirmationRequiredError,
	InsufficientCreditsError,
} from '../lib/credit-errors.js';
import { stripe } from '../lib/stripe.js';
import { creditRepository } from '../repositories/credit.js';
import type { CreditFeature } from '../types/credit.js';

interface ChargeHandle {
	cost: number;
	balance: number;
	refund: () => Promise<void>;
}

class CreditService {
	async getBalance(customerId: string) {
		return { balance: await creditRepository.getBalance(customerId) };
	}

	async listCosts() {
		return creditRepository.listFeatureCosts();
	}

	async charge(params: {
		customerId: string;
		feature: CreditFeature;
		idempotencyKey: string;
		confirmed: boolean;
		metadata?: Record<string, unknown>;
	}): Promise<ChargeHandle> {
		const { customerId, feature, idempotencyKey, confirmed } = params;
		const cost = await creditRepository.getFeatureCost(feature);
		const balance = await creditRepository.getBalance(customerId);

		if (!confirmed) {
			throw new CreditConfirmationRequiredError(feature, cost, balance);
		}
		if (balance < cost) {
			throw new InsufficientCreditsError(feature, cost, balance);
		}

		const newBalance = await creditRepository.consume({
			customerId,
			feature,
			cost,
			idempotencyKey,
			metadata: params.metadata ?? {},
		});

		return {
			cost,
			balance: newBalance,
			refund: async () => {
				await creditRepository.refund({
					customerId,
					amount: cost,
					feature,
					idempotencyKey: `refund:${idempotencyKey}`,
				});
			},
		};
	}

	async createCheckout(customerId: string, packageId: string) {
		const pkg = await creditRepository.findPackageById(packageId);
		if (pkg.status !== 'ativo') throw new Error('Package is not active');
		if (!pkg.stripePriceId)
			throw new Error('Package not configured for payments');

		const session = await stripe.checkout.sessions.create({
			line_items: [{ price: pkg.stripePriceId, quantity: 1 }],
			mode: 'payment',
			payment_method_types: ['card', 'boleto'],
			success_url: `${process.env.COURSES_URL ?? 'https://profissaolaser.com.br/course'}?session_id={CHECKOUT_SESSION_ID}`,
			cancel_url: process.env.CANCEL_URL ?? 'http://localhost:3000/cancelado',
			metadata: {
				type: 'credit_purchase',
				customer_id: customerId,
				package_id: pkg.id,
			},
		});
		return { checkoutUrl: session.url ?? '', sessionId: session.id };
	}

	async fulfillPurchase(session: {
		id: string;
		metadata: Record<string, string> | null;
	}): Promise<number> {
		const customerId = session.metadata?.customer_id;
		const packageId = session.metadata?.package_id;
		if (!customerId || !packageId) {
			throw new Error('Missing credit_purchase metadata');
		}
		const pkg = await creditRepository.findPackageById(packageId);
		return creditRepository.addCredits({
			customerId,
			amount: pkg.credits,
			packageId,
			stripeSessionId: session.id,
		});
	}

	async listPackages(onlyActive: boolean) {
		return creditRepository.listPackages(onlyActive);
	}

	async createPackage(data: {
		name: string;
		description?: string;
		credits: number;
		price: number;
	}) {
		const stripeProduct = await stripe.products.create({
			name: data.name,
			description: data.description || undefined,
		});
		const stripePrice = await stripe.prices.create({
			product: stripeProduct.id,
			unit_amount: Math.round(data.price * 100),
			currency: 'brl',
		});
		return creditRepository.createPackage({
			name: data.name,
			description: data.description,
			credits: data.credits,
			price: data.price,
			stripeProductId: stripeProduct.id,
			stripePriceId: stripePrice.id,
		});
	}

	async updatePackage(
		id: string,
		data: {
			name?: string;
			description?: string;
			credits?: number;
			price?: number;
		},
	) {
		const existing = await creditRepository.findPackageById(id);
		if (data.name && existing.stripeProductId) {
			await stripe.products.update(existing.stripeProductId, {
				name: data.name,
				...(data.description !== undefined && {
					description: data.description,
				}),
			});
		}
		const patch: Record<string, unknown> = {};
		if (data.name !== undefined) patch.name = data.name;
		if (data.description !== undefined) patch.description = data.description;
		if (data.credits !== undefined) patch.credits = data.credits;
		if (data.price !== undefined && existing.stripeProductId) {
			const newPrice = await stripe.prices.create({
				product: existing.stripeProductId,
				unit_amount: Math.round(data.price * 100),
				currency: 'brl',
			});
			patch.price = data.price;
			patch.stripePriceId = newPrice.id;
		}
		return creditRepository.updatePackage(id, patch);
	}

	async setPackageStatus(id: string, active: boolean) {
		return creditRepository.updatePackage(id, {
			status: active ? 'ativo' : 'inativo',
		});
	}

	async setFeatureCost(feature: string, cost: number) {
		await creditRepository.setFeatureCost(feature, cost);
		return { feature, cost };
	}

	async adjust(customerId: string, amount: number, reason: string) {
		const balance = await creditRepository.adjust(customerId, amount, reason);
		return { balance };
	}

	async listHistory(customerId: string, page: number, limit: number) {
		const { data, total } = await creditRepository.listTransactions(
			customerId,
			page,
			limit,
		);
		return { data, total, page, limit };
	}
}

export const creditService = new CreditService();
