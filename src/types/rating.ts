import { z } from 'zod';

export const ratingResponseSchema = z.object({
	myRating: z.number().nullable(),
	averageRating: z.number(),
	totalRatings: z.number(),
});

export const createRatingSchema = z.object({
	stars: z.number().int().min(1).max(5),
});

export type RatingResponse = z.infer<typeof ratingResponseSchema>;
export type CreateRating = z.infer<typeof createRatingSchema>;
