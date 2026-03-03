import { z } from 'zod';

export const lessonSchema = z.object({
	id: z.string(),
	moduleId: z.string(),
	productId: z.string(),
	title: z.string(),
	description: z.string().nullable(),
	videoUrl: z.string().nullable(),
	duration: z.number().int().nullable(),
	order: z.number().int(),
	isFree: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type Lesson = z.infer<typeof lessonSchema>;

export const createLessonSchema = z.object({
	moduleId: z.string(),
	productId: z.string(),
	title: z.string(),
	description: z.string().optional(),
	videoUrl: z.url().nullable(),
	duration: z.number().int().positive().optional(),
	order: z.number().int().nonnegative(),
	isFree: z.boolean().default(false),
});

export type LessonCreate = z.infer<typeof createLessonSchema>;

export const updateLessonSchema = z.object({
	title: z.string().optional(),
	description: z.string().optional(),
	videoUrl: z.url().nullable(),
	duration: z.number().int().positive().optional(),
	order: z.number().int().nonnegative().optional(),
	isFree: z.boolean().optional(),
});

export type LessonUpdate = z.infer<typeof updateLessonSchema>;

export const reorderLessonsSchema = z.object({
	moduleId: z.string(),
	lessonIds: z.array(z.string()).min(1),
});

export const presignedVideoUrlSchema = z.object({
	filename: z.string().optional(),
});

export const confirmVideoUploadSchema = z.object({
	path: z.string().min(1, 'Path is required'),
});
