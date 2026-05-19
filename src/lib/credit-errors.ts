import type { CreditFeature } from '../types/credit.js';

/** Operação custa crédito e o request não confirmou o gasto. */
export class CreditConfirmationRequiredError extends Error {
	constructor(
		public readonly feature: CreditFeature,
		public readonly cost: number,
		public readonly balance: number,
	) {
		super(`Confirmação necessária: ${feature} custa ${cost} crédito(s)`);
		this.name = 'CreditConfirmationRequiredError';
	}
}

/** Confirmou o gasto mas o saldo é insuficiente. */
export class InsufficientCreditsError extends Error {
	constructor(
		public readonly feature: CreditFeature,
		public readonly cost: number,
		public readonly balance: number,
	) {
		super(`Saldo insuficiente: ${feature} custa ${cost}, saldo ${balance}`);
		this.name = 'InsufficientCreditsError';
	}
}
