// ─────────────────────────────────────────────────────────────────────
// Limites grátis para usuários SEM saldo de voxes (free tier).
//
// Quem tem balance > 0 é cobrado normalmente em voxes e NÃO encontra estes
// limites. Quem tem balance == 0 pode usar a ferramenta de graça respeitando:
//   • prévia      → 2 / semana (reset segunda 00:00 BRT)
//   • vetorização → 5 / dia    (reset 00:00 BRT)
//   • editor-ai   → 2 / semana (reset segunda 00:00 BRT)
//
// Ao bater o limite o serviço lança FreeTierQuotaError; o controller mapeia
// para HTTP 429 com payload estruturado (front mostra modal "Comprar voxes").
// ─────────────────────────────────────────────────────────────────────

import type { CreditFeature } from '../types/credit.js';

export const FREE_PREVIA_WEEKLY = 2;
export const FREE_VECTORIZE_DAILY = 5;
export const FREE_EDITOR_AI_WEEKLY = 2;

export type FreeTierPeriod = 'daily' | 'weekly';

export interface FreeTierLimitConfig {
	limit: number;
	period: FreeTierPeriod;
}

export const FREE_TIER_LIMITS: Record<CreditFeature, FreeTierLimitConfig> = {
	previa: { limit: FREE_PREVIA_WEEKLY, period: 'weekly' },
	vectorize: { limit: FREE_VECTORIZE_DAILY, period: 'daily' },
	'editor-ai': { limit: FREE_EDITOR_AI_WEEKLY, period: 'weekly' },
};

export class FreeTierQuotaError extends Error {
	constructor(
		public readonly feature: CreditFeature,
		public readonly limit: number,
		public readonly used: number,
		public readonly period: FreeTierPeriod,
		public readonly resetsAt: string, // ISO 8601 UTC
		public readonly balance: number, // sempre 0 quando esta error é lançado
	) {
		super(
			`Limite gratuito de ${limit} usos por ${period === 'daily' ? 'dia' : 'semana'} atingido para ${feature}`,
		);
		this.name = 'FreeTierQuotaError';
	}
}
