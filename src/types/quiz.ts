import { z } from 'zod';

export const quizOptionSchema = z.object({
	id: z.string().uuid(),
	text: z.string(),
	isCorrect: z.boolean(),
});

export const quizQuestionSchema = z.object({
	id: z.string().uuid(),
	text: z.string(),
	order: z.number().int(),
	options: z.array(quizOptionSchema),
});

export const quizSchema = z.object({
	id: z.string().uuid(),
	lessonId: z.string(),
	title: z.string(),
	questions: z.array(quizQuestionSchema),
	createdAt: z.string(),
});

export const createQuizSchema = z.object({
	title: z.string(),
});

const optionInputSchema = z.object({
	text: z.string(),
	isCorrect: z.boolean(),
});

export const createQuestionSchema = z
	.object({
		text: z.string(),
		order: z.number().int().nonnegative(),
		options: z.array(optionInputSchema).min(2),
	})
	.refine((data) => data.options.filter((o) => o.isCorrect).length === 1, {
		message: 'Exactly one option must be correct',
		path: ['options'],
	});

export const updateQuestionSchema = z
	.object({
		text: z.string().optional(),
		order: z.number().int().nonnegative().optional(),
		options: z.array(optionInputSchema).min(2).optional(),
	})
	.refine(
		(data) =>
			!data.options || data.options.filter((o) => o.isCorrect).length === 1,
		{
			message: 'Exactly one option must be correct',
			path: ['options'],
		},
	);

export type CreateQuestion = z.infer<typeof createQuestionSchema>;
export type UpdateQuestion = z.infer<typeof updateQuestionSchema>;
