import { startOfTodayBRT, startOfWeekBRT } from '../lib/datetime.js';
import { supabase } from '../lib/supabase.js';
import type { CreditFeature } from '../types/credit.js';

class FreeToolUsageRepository {
	/** Loga uma utilização gratuita (apenas para usuários com saldo 0). */
	async log(customerId: string, feature: CreditFeature): Promise<void> {
		const { error } = await supabase.from('pl_free_tool_usage').insert({
			customerId,
			feature,
		});
		if (error) throw new Error(error.message);
	}

	/** Conta usos gratuitos de uma feature hoje (00:00 BRT em diante). */
	async countToday(
		customerId: string,
		feature: CreditFeature,
	): Promise<number> {
		const startOfDay = startOfTodayBRT();
		const { count, error } = await supabase
			.from('pl_free_tool_usage')
			.select('*', { count: 'exact', head: true })
			.eq('customerId', customerId)
			.eq('feature', feature)
			.gte('createdAt', startOfDay.toISOString());
		if (error) throw new Error(error.message);
		return count ?? 0;
	}

	/** Conta usos gratuitos de uma feature nesta semana (segunda 00:00 BRT em diante). */
	async countThisWeek(
		customerId: string,
		feature: CreditFeature,
	): Promise<number> {
		const startOfWeek = startOfWeekBRT();
		const { count, error } = await supabase
			.from('pl_free_tool_usage')
			.select('*', { count: 'exact', head: true })
			.eq('customerId', customerId)
			.eq('feature', feature)
			.gte('createdAt', startOfWeek.toISOString());
		if (error) throw new Error(error.message);
		return count ?? 0;
	}
}

export const freeToolUsageRepository = new FreeToolUsageRepository();
