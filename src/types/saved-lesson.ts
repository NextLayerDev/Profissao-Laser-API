import { z } from 'zod';

export const savedLessonSchema = z.object({
	id: z.uuid(),
	lessonId: z.uuid(),
	lesson: z.object({
		id: z.uuid(),
		title: z.string(),
		duration: z.number().nullable(),
		videoUrl: z.string().nullable(),
	}),
	courseSlug: z.string(),
	courseName: z.string(),
});

export const saveLessonSchema = z.object({
	lessonId: z.string().uuid(),
});

export type SavedLesson = z.infer<typeof savedLessonSchema>;
