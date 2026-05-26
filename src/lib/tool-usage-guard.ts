// ─────────────────────────────────────────────────────────────────────
// Guard único para uso de ferramentas IA (prévia / vetorização / editor-ai).
//
// Política:
//  • balance > 0: cobra voxes normalmente. Refund em caso de falha.
//  • balance == 0: entra na trilha gratuita. Aplica limite (semanal/diário).
//    Loga o uso somente após sucesso da operação (commit).
//
// Uso:
//   const guard = await reserveToolUsage({ customerId, feature, confirmed });
//   try {
//     const result = await actuallyDoTheWork();
//     await guard.commit();      // loga uso grátis se foi free-tier; noop se paid
//     return result;
//   } catch (err) {
//     await guard.rollback();    // refund se foi paid; noop se foi free-tier
//     throw err;
//   }
//
// Erros lançados:
//   • CreditConfirmationRequiredError (402)  → balance > 0 e confirmed=false
//   • InsufficientCreditsError       (402)  → balance > 0 e < cost
//   • FreeTierQuotaError             (429)  → balance == 0 e atingiu limite
// ─────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { freeToolUsageRepository } from '../repositories/free-tool-usage.js';
import { creditService } from '../services/credit.js';
import type { CreditFeature } from '../types/credit.js';
import { startOfNextWeekBRT, startOfTomorrowBRT } from './datetime.js';
import { FREE_TIER_LIMITS, FreeTierQuotaError } from './free-tier-quota.js';

export interface ReservedToolUsage {
	isFree: boolean;
	balance: number;
	commit(): Promise<void>;
	rollback(): Promise<void>;
}

interface ReserveParams {
	customerId: string;
	feature: CreditFeature;
	confirmed: boolean;
	/**
	 * Idempotency key opcional. Se omitido geramos um aleatório.
	 * Importante quando o caller quer reaproveitar o mesmo identificador
	 * (ex.: retries internos).
	 */
	idempotencyKey?: string;
	/**
	 * Conta de teste ilimitada: ignora cobrança de voxes E limite do tier
	 * gratuito (sem débito, sem log). Definido a partir de
	 * `request.isUnlimitedCustomer`.
	 */
	unlimited?: boolean;
}

export async function reserveToolUsage(
	params: ReserveParams,
): Promise<ReservedToolUsage> {
	const { customerId, feature, confirmed } = params;

	// ── Conta de teste ilimitada: bypass total ───────────────────────
	if (params.unlimited) {
		return {
			isFree: false,
			balance: Number.POSITIVE_INFINITY,
			commit: async () => {},
			rollback: async () => {},
		};
	}

	const { balance } = await creditService.getBalance(customerId);

	// ── Tier gratuito ────────────────────────────────────────────────
	if (balance === 0) {
		const { limit, period } = FREE_TIER_LIMITS[feature];
		const used =
			period === 'daily'
				? await freeToolUsageRepository.countToday(customerId, feature)
				: await freeToolUsageRepository.countThisWeek(customerId, feature);

		if (used >= limit) {
			const resetsAt =
				period === 'daily'
					? startOfTomorrowBRT().toISOString()
					: startOfNextWeekBRT().toISOString();
			throw new FreeTierQuotaError(
				feature,
				limit,
				used,
				period,
				resetsAt,
				balance,
			);
		}

		return {
			isFree: true,
			balance,
			commit: () => freeToolUsageRepository.log(customerId, feature),
			rollback: async () => {
				/* nada a desfazer no caminho gratuito */
			},
		};
	}

	// ── Tier pago (voxes) ────────────────────────────────────────────
	const idempotencyKey =
		params.idempotencyKey ?? `${feature}:${customerId}:${crypto.randomUUID()}`;
	const handle = await creditService.charge({
		customerId,
		feature,
		idempotencyKey,
		confirmed,
	});

	return {
		isFree: false,
		balance: handle.balance,
		commit: async () => {
			/* já consumiu na hora do charge */
		},
		rollback: () => handle.refund(),
	};
}
