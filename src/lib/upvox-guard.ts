// ─────────────────────────────────────────────────────────────────────
// Guard para uso de ferramentas IA delegando à upvox-api.
//
// Política:
//   • Conta de teste ilimitada → bypass total (sem chamar upvox).
//   • Caso contrário → POST /v1/tool/:toolKey/invoke (cobra atomicamente).
//
// Rollback:
//   A upvox-api NÃO expõe refund da invocation; o admin precisa fazer
//   ajuste manual via POST /v1/voxes/adjust. Para não perder o rastro,
//   gravamos em upvox_reconciliation_pending sempre que o handler local
//   falhar APÓS a cobrança ter sido efetuada.
// ─────────────────────────────────────────────────────────────────────

import { supabase } from './supabase.js';
import {
	getBalance,
	invokeTool,
	type UpvoxInvokeResponse,
} from './upvox-client.js';

export interface ReservedUpvoxUsage {
	/** true quando é conta ilimitada (sem cobrança / sem chamada). */
	unlimited: boolean;
	invocationId: string | null;
	quotaConsumed: number;
	voxesSpent: number;
	balance: number;
	/** Chame no sucesso. No-op (a cobrança já foi feita no invoke). */
	commit(): Promise<void>;
	/** Chame na falha do handler local — registra reconciliação pendente. */
	rollback(reason: string): Promise<void>;
}

interface ReserveParams {
	jwt: string;
	customerId: string;
	toolKey: string;
	courseSlug: string;
	unlimited?: boolean;
}

export async function reserveUpvoxTool(
	params: ReserveParams,
): Promise<ReservedUpvoxUsage> {
	const { jwt, customerId, toolKey, courseSlug, unlimited } = params;

	if (unlimited) {
		return {
			unlimited: true,
			invocationId: null,
			quotaConsumed: 0,
			voxesSpent: 0,
			balance: Number.POSITIVE_INFINITY,
			commit: async () => {},
			rollback: async () => {},
		};
	}

	const result: UpvoxInvokeResponse = await invokeTool(
		jwt,
		toolKey,
		courseSlug,
	);

	return {
		unlimited: false,
		invocationId: result.invocation_id,
		quotaConsumed: result.quota_consumed,
		voxesSpent: result.voxes_spent,
		balance: result.balance,
		commit: async () => {},
		rollback: async (reason: string) => {
			// Só registra reconciliação se houve débito de voxes; consumo de
			// quota grátis não custa nada ao customer.
			if (result.voxes_spent <= 0) return;
			const { error } = await supabase
				.from('upvox_reconciliation_pending')
				.insert({
					invocation_id: result.invocation_id,
					customer_id: customerId,
					tool_key: toolKey,
					course_slug: courseSlug,
					voxes_spent: result.voxes_spent,
					reason,
				});
			if (error) {
				console.error('[upvox-guard] failed to persist reconciliation row', {
					invocationId: result.invocation_id,
					customerId,
					toolKey,
					voxesSpent: result.voxes_spent,
					reason,
					error: error.message,
				});
			}
		},
	};
}

/** Re-export para callers que ainda precisem só do saldo. */
export { getBalance };
