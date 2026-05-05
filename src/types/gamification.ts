import { z } from 'zod';

export const recentBadgeSchema = z.object({
	id: z.string(),
	name: z.string(),
	icon: z.string(),
	earnedAt: z.string(),
});

export const gamificationSummarySchema = z.object({
	level: z.number().int(),
	currentXp: z.number().int(),
	nextLevelXp: z.number().int(),
	dailyXp: z.number().int(),
	dailyXpGoal: z.number().int(),
	streak: z.object({
		current: z.number().int(),
		best: z.number().int(),
	}),
	recentBadges: z.array(recentBadgeSchema),
});

export const gamificationBadgeSchema = z.object({
	id: z.string(),
	name: z.string(),
	icon: z.string(),
	description: z.string().nullable().optional(),
	earned: z.boolean(),
	earnedAt: z.string().nullable().optional(),
});

export const weekDaySchema = z.object({
	day: z.string(),
	date: z.string(),
	completed: z.boolean(),
});

export const gamificationStreakSchema = z.object({
	currentStreak: z.number().int(),
	bestStreak: z.number().int(),
	weekMap: z.array(weekDaySchema),
});

export const challengeSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string(),
	type: z.string(),
	goal: z.number().int(),
	currentProgress: z.number().int(),
	participants: z.number().int(),
	endsAt: z.string(),
	reward: z.object({
		xp: z.number().int(),
		badge: z.string().nullable().optional(),
	}),
	joined: z.boolean(),
});

export type GamificationSummary = z.infer<typeof gamificationSummarySchema>;
export type GamificationBadge = z.infer<typeof gamificationBadgeSchema>;
export type GamificationStreak = z.infer<typeof gamificationStreakSchema>;
export type Challenge = z.infer<typeof challengeSchema>;
