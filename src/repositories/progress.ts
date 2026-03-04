import { supabase } from '../lib/supabase.js';

class ProgressRepository {
	async listByCourse(customerId: string, courseId: string): Promise<string[]> {
		const { data, error } = await supabase
			.from('customer_lesson_completions')
			.select('lesson_id, pl_lesson!inner(productId)')
			.eq('customer_id', customerId)
			.eq('pl_lesson.productId', courseId);

		if (error) throw new Error(error.message);

		return (data ?? []).map((row) => row.lesson_id);
	}

	async complete(
		customerId: string,
		lessonId: string,
	): Promise<{ lessonId: string; completedAt: string }> {
		const { data, error } = await supabase
			.from('customer_lesson_completions')
			.upsert(
				{
					customer_id: customerId,
					lesson_id: lessonId,
					completed_at: new Date().toISOString(),
				},
				{ onConflict: 'customer_id,lesson_id' },
			)
			.select('lesson_id, completed_at')
			.single();

		if (error) throw new Error(error.message);

		return {
			lessonId: data.lesson_id,
			completedAt: data.completed_at,
		};
	}
}

export const progressRepository = new ProgressRepository();
