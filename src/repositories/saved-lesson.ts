import { supabase } from '../lib/supabase.js';
import type { SavedLesson } from '../types/saved-lesson.js';

class SavedLessonRepository {
	async list(customerId: string): Promise<SavedLesson[]> {
		const { data: saved, error } = await supabase
			.from('customer_saved_lessons')
			.select('id, lesson_id, created_at')
			.eq('customer_id', customerId);

		if (error) throw new Error(error.message);
		if (!saved || saved.length === 0) return [];

		const lessonIds = saved.map((s) => s.lesson_id);

		const { data: lessons, error: lessonError } = await supabase
			.from('pl_lesson')
			.select('id, title, duration, videoUrl, productId')
			.in('id', lessonIds);

		if (lessonError) throw new Error(lessonError.message);

		const productIds = [
			...new Set((lessons ?? []).map((l) => l.productId).filter(Boolean)),
		];

		const { data: products, error: productError } = await supabase
			.from('pl_product')
			.select('id, slug, name')
			.in('id', productIds);

		if (productError) throw new Error(productError.message);

		const lessonMap = new Map((lessons ?? []).map((l) => [l.id, l]));
		const productMap = new Map((products ?? []).map((p) => [p.id, p]));

		return saved.map((s) => {
			const lesson = lessonMap.get(s.lesson_id);
			const product = lesson ? productMap.get(lesson.productId) : undefined;
			return {
				id: s.id,
				lessonId: s.lesson_id,
				lesson: {
					id: lesson?.id ?? s.lesson_id,
					title: lesson?.title ?? '',
					duration: lesson?.duration ?? null,
					videoUrl: lesson?.videoUrl ?? null,
				},
				courseSlug: product?.slug ?? '',
				courseName: product?.name ?? '',
			};
		});
	}

	async save(customerId: string, lessonId: string): Promise<SavedLesson> {
		const { data: lesson, error: lessonError } = await supabase
			.from('pl_lesson')
			.select('id, title, duration, videoUrl, productId')
			.eq('id', lessonId)
			.maybeSingle();

		if (lessonError) throw new Error(lessonError.message);
		if (!lesson) {
			const err = new Error('Lesson not found') as Error & {
				statusCode: number;
			};
			err.statusCode = 404;
			throw err;
		}

		const { data: subscription, error: subError } = await supabase
			.from('pl_subscription')
			.select('id')
			.eq('userId', customerId)
			.eq('productId', lesson.productId)
			.eq('status', 'active')
			.limit(1)
			.maybeSingle();

		if (subError) throw new Error(subError.message);
		if (!subscription) {
			const err = new Error('Active subscription required') as Error & {
				statusCode: number;
			};
			err.statusCode = 403;
			throw err;
		}

		const { data: existing, error: existingError } = await supabase
			.from('customer_saved_lessons')
			.select('id')
			.eq('customer_id', customerId)
			.eq('lesson_id', lessonId)
			.maybeSingle();

		if (existingError) throw new Error(existingError.message);

		let savedId: string;

		if (existing) {
			savedId = existing.id;
		} else {
			const { data: inserted, error: insertError } = await supabase
				.from('customer_saved_lessons')
				.insert({ customer_id: customerId, lesson_id: lessonId })
				.select('id')
				.single();

			if (insertError) throw new Error(insertError.message);
			savedId = inserted.id;
		}

		const { data: product, error: productError } = await supabase
			.from('pl_product')
			.select('id, slug, name')
			.eq('id', lesson.productId)
			.maybeSingle();

		if (productError) throw new Error(productError.message);

		return {
			id: savedId,
			lessonId: lesson.id,
			lesson: {
				id: lesson.id,
				title: lesson.title,
				duration: lesson.duration ?? null,
				videoUrl: lesson.videoUrl ?? null,
			},
			courseSlug: product?.slug ?? '',
			courseName: product?.name ?? '',
		};
	}

	async remove(customerId: string, lessonId: string): Promise<void> {
		const { error, count } = await supabase
			.from('customer_saved_lessons')
			.delete({ count: 'exact' })
			.eq('customer_id', customerId)
			.eq('lesson_id', lessonId);

		if (error) throw new Error(error.message);
		if (count === 0) {
			const err = new Error('Saved lesson not found') as Error & {
				statusCode: number;
			};
			err.statusCode = 404;
			throw err;
		}
	}
}

export const savedLessonRepository = new SavedLessonRepository();
