import { todayBRT, yesterdayBRT } from '../lib/datetime.js';
import { gamificationRepository } from '../repositories/gamification.js';
import { loginStreakRepository } from '../repositories/login-streak.js';

export const loginStreakService = {
	async record(userId: string): Promise<void> {
		const today = todayBRT();

		const alreadyRecorded = await loginStreakRepository.hasDay(userId, today);
		if (alreadyRecorded) return;

		await loginStreakRepository.recordDay(userId, today);

		const profile = await gamificationRepository.getProfile(userId);
		const currentStreak = profile?.currentStreak ?? 0;
		const bestStreak = profile?.bestStreak ?? 0;

		const hadYesterday = await loginStreakRepository.hasDay(
			userId,
			yesterdayBRT(),
		);
		const newStreak = hadYesterday ? currentStreak + 1 : 1;
		const newBest = Math.max(bestStreak, newStreak);

		await gamificationRepository.upsertLoginStreak(userId, newStreak, newBest);
	},
};
