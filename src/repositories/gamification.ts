import { supabase } from '../lib/supabase.js';

const DEFAULT_DAILY_XP_GOAL = 100;

class GamificationRepository {
	async getProfile(userId: string) {
		const { data, error } = await supabase
			.from('pl_gamification_profile')
			.select('*')
			.eq('userId', userId)
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data as {
			level: number;
			currentXp: number;
			nextLevelXp: number;
			dailyXp: number;
			dailyXpGoal: number;
			currentStreak: number;
			bestStreak: number;
		} | null;
	}

	async getRecentBadges(userId: string, limit = 3) {
		const { data, error } = await supabase
			.from('pl_gamification_user_badge')
			.select(`
				earnedAt,
				pl_gamification_badge (
					id,
					name,
					icon
				)
			`)
			.eq('userId', userId)
			.order('earnedAt', { ascending: false })
			.limit(limit);

		if (error) throw new Error(error.message);

		return (data ?? []).map((row) => {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic nested join result
			const badge = (row as any).pl_gamification_badge;
			return {
				id: badge?.id ?? '',
				name: badge?.name ?? '',
				icon: badge?.icon ?? '',
				earnedAt: row.earnedAt as string,
			};
		});
	}

	async getAllBadges(userId: string) {
		const [
			{ data: allBadges, error: badgesError },
			{ data: userBadges, error: userError },
		] = await Promise.all([
			supabase
				.from('pl_gamification_badge')
				.select('id, name, icon, description')
				.order('name'),
			supabase
				.from('pl_gamification_user_badge')
				.select('badgeId, earnedAt')
				.eq('userId', userId),
		]);

		if (badgesError) throw new Error(badgesError.message);
		if (userError) throw new Error(userError.message);

		const earnedMap = new Map<string, string>();
		for (const ub of userBadges ?? []) {
			earnedMap.set(
				(ub as unknown as { badgeId: string }).badgeId,
				(ub as unknown as { earnedAt: string }).earnedAt,
			);
		}

		return (allBadges ?? []).map((badge) => {
			const b = badge as unknown as {
				id: string;
				name: string;
				icon: string;
				description: string | null;
			};
			return {
				id: b.id,
				name: b.name,
				icon: b.icon,
				description: b.description,
				earned: earnedMap.has(b.id),
				earnedAt: earnedMap.get(b.id) ?? null,
			};
		});
	}

	async getStudiedDaysInWeek(userId: string, weekDates: string[]) {
		const { data, error } = await supabase
			.from('pl_gamification_study_day')
			.select('date')
			.eq('userId', userId)
			.in('date', weekDates);

		if (error) throw new Error(error.message);
		return new Set(
			(data ?? []).map((row) => (row as unknown as { date: string }).date),
		);
	}

	async getActiveChallenge(userId: string) {
		const { data, error } = await supabase
			.from('pl_challenge')
			.select(
				'id, title, description, type, goal, endsAt, rewardXp, rewardBadge',
			)
			.eq('isActive', true)
			.order('createdAt', { ascending: false })
			.limit(1)
			.maybeSingle();

		if (error) throw new Error(error.message);
		if (!data) return null;

		const challenge = data as unknown as {
			id: string;
			title: string;
			description: string;
			type: string;
			goal: number;
			endsAt: string;
			rewardXp: number;
			rewardBadge: string | null;
		};

		const [{ count }, { data: participant }] = await Promise.all([
			supabase
				.from('pl_challenge_participant')
				.select('id', { count: 'exact', head: true })
				.eq('challengeId', challenge.id),
			supabase
				.from('pl_challenge_participant')
				.select('progress')
				.eq('challengeId', challenge.id)
				.eq('userId', userId)
				.maybeSingle(),
		]);

		const p = participant as unknown as { progress: number } | null;

		return {
			id: challenge.id,
			title: challenge.title,
			description: challenge.description,
			type: challenge.type,
			goal: challenge.goal,
			currentProgress: p?.progress ?? 0,
			participants: count ?? 0,
			endsAt: challenge.endsAt,
			reward: {
				xp: challenge.rewardXp,
				badge: challenge.rewardBadge,
			},
			joined: !!participant,
		};
	}

	async joinChallenge(challengeId: string, userId: string) {
		const { data: existing } = await supabase
			.from('pl_challenge_participant')
			.select('id')
			.eq('challengeId', challengeId)
			.eq('userId', userId)
			.maybeSingle();

		if (existing) throw new Error('Você já está participando deste desafio');

		const { data: challenge } = await supabase
			.from('pl_challenge')
			.select('id')
			.eq('id', challengeId)
			.eq('isActive', true)
			.maybeSingle();

		if (!challenge) throw new Error('Desafio não encontrado ou inativo');

		const { data, error } = await supabase
			.from('pl_challenge_participant')
			.insert({
				id: crypto.randomUUID(),
				challengeId,
				userId,
				progress: 0,
				joinedAt: new Date().toISOString(),
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return data;
	}
}

export const gamificationRepository = new GamificationRepository();
export { DEFAULT_DAILY_XP_GOAL };
