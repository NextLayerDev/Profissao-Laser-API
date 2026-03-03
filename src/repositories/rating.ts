import { supabase } from '../lib/supabase.js';

class RatingRepository {
	async findByLessonAndCustomer(lessonId: string, customerId: string) {
		const { data, error } = await supabase
			.from('pl_lesson_rating')
			.select('stars')
			.eq('lesson_id', lessonId)
			.eq('customer_id', customerId)
			.maybeSingle();

		if (error) throw new Error(error.message);
		return data ? (data.stars as number) : null;
	}

	async upsert(lessonId: string, customerId: string, stars: number) {
		const { error } = await supabase
			.from('pl_lesson_rating')
			.upsert(
				{ lesson_id: lessonId, customer_id: customerId, stars },
				{ onConflict: 'lesson_id,customer_id' },
			);

		if (error) throw new Error(error.message);
	}

	async getAllByLesson(lessonId: string) {
		const { data, error } = await supabase
			.from('pl_lesson_rating')
			.select('stars')
			.eq('lesson_id', lessonId);

		if (error) throw new Error(error.message);

		const rows = (data ?? []) as { stars: number }[];
		const totalRatings = rows.length;
		const averageRating =
			totalRatings === 0
				? 0
				: rows.reduce((sum, r) => sum + r.stars, 0) / totalRatings;

		return { averageRating, totalRatings };
	}
}

export const ratingRepository = new RatingRepository();
