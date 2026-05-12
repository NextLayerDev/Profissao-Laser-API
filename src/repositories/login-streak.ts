import { supabase } from '../lib/supabase.js';

class LoginStreakRepository {
	async hasDay(userId: string, date: string): Promise<boolean> {
		const { data } = await supabase
			.from('pl_login_day')
			.select('id')
			.eq('userId', userId)
			.eq('date', date)
			.maybeSingle();
		return !!data;
	}

	async recordDay(userId: string, date: string): Promise<void> {
		const { error } = await supabase
			.from('pl_login_day')
			.upsert(
				{ userId, date },
				{ onConflict: 'userId,date', ignoreDuplicates: true },
			);
		if (error) throw new Error(error.message);
	}
}

export const loginStreakRepository = new LoginStreakRepository();
