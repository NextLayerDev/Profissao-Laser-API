import { z } from 'zod';

export const completionSchema = z.object({
	lessonId: z.uuid(),
	completedAt: z.string(),
});

export const courseProgressSchema = z.object({
	watchedLessonIds: z.array(z.string()),
});

export const completeBodySchema = z.object({
	customerId: z.uuid().optional(),
});

export const progressQuerySchema = z.object({
	customerId: z.uuid().optional(),
});
