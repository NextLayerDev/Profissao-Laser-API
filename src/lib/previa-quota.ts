// ─────────────────────────────────────────────────────────────────────
// Quota diário de prévias IA por customer.
// Limite atual: 5 prévias/dia (BRT). Reset à meia-noite no horário de Brasília.
// ─────────────────────────────────────────────────────────────────────

export const DAILY_PREVIA_LIMIT = 5;

/**
 * Erro lançado quando o customer ultrapassa o limite diário.
 * O controller mapeia isso para HTTP 429 com payload estruturado.
 */
export class DailyLimitError extends Error {
	constructor(
		public readonly limit: number,
		public readonly used: number,
		public readonly resetsAt: string, // ISO 8601 UTC
	) {
		super(`Limite diário de ${limit} prévias atingido`);
		this.name = 'DailyLimitError';
	}
}
