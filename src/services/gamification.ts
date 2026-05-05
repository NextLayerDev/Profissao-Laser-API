import { withCapture } from '../lib/sentry.js';
import {
	DEFAULT_DAILY_XP_GOAL,
	gamificationRepository,
} from '../repositories/gamification.js';

const PT_WEEK_DAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];

function getCurrentWeekDates() {
	const today = new Date();
	const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
	const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
	const monday = new Date(today);
	monday.setDate(today.getDate() + mondayOffset);

	return PT_WEEK_DAYS.map((day, i) => {
		const date = new Date(monday);
		date.setDate(monday.getDate() + i);
		return { day, date: date.toISOString().split('T')[0] };
	});
}

export const gamificationService = {
	async getSummary(userId: string) {
		return withCapture(async () => {
			const [profile, recentBadges] = await Promise.all([
				gamificationRepository.getProfile(userId),
				gamificationRepository.getRecentBadges(userId, 3),
			]);

			return {
				level: profile?.level ?? 1,
				currentXp: profile?.currentXp ?? 0,
				nextLevelXp: profile?.nextLevelXp ?? 500,
				dailyXp: profile?.dailyXp ?? 0,
				dailyXpGoal: profile?.dailyXpGoal ?? DEFAULT_DAILY_XP_GOAL,
				streak: {
					current: profile?.currentStreak ?? 0,
					best: profile?.bestStreak ?? 0,
				},
				recentBadges,
			};
		});
	},

	async getBadges(userId: string) {
		return withCapture(() => gamificationRepository.getAllBadges(userId));
	},

	async getStreak(userId: string) {
		return withCapture(async () => {
			const weekEntries = getCurrentWeekDates();
			const weekDates = weekEntries.map((e) => e.date);

			const [profile, studiedDays] = await Promise.all([
				gamificationRepository.getProfile(userId),
				gamificationRepository.getStudiedDaysInWeek(userId, weekDates),
			]);

			return {
				currentStreak: profile?.currentStreak ?? 0,
				bestStreak: profile?.bestStreak ?? 0,
				weekMap: weekEntries.map(({ day, date }) => ({
					day,
					date,
					completed: studiedDays.has(date),
				})),
			};
		});
	},

	async getActiveChallenge(userId: string) {
		return withCapture(() => gamificationRepository.getActiveChallenge(userId));
	},

	async joinChallenge(challengeId: string, userId: string) {
		return withCapture(() =>
			gamificationRepository.joinChallenge(challengeId, userId),
		);
	},
};
