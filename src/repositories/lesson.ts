import { supabase } from '../lib/supabase.js';
import type { LessonCreate, LessonUpdate } from '../types/lesson.js';

class LessonRepository {
	async create(data: LessonCreate & { id: string }) {
		const now = new Date().toISOString();
		const { data: lesson, error } = await supabase
			.from('pl_lesson')
			.insert({ ...data, createdAt: now, updatedAt: now })
			.select()
			.single();

		if (error) throw new Error(error.message);
		return lesson;
	}

	async update(id: string, data: LessonUpdate) {
		const { data: lesson, error } = await supabase
			.from('pl_lesson')
			.update({ ...data, updatedAt: new Date().toISOString() })
			.eq('id', id)
			.select()
			.single();

		if (error) throw new Error(error.message);
		if (!lesson) throw new Error('Lesson not found');
		return lesson;
	}

	async delete(id: string) {
		const { error } = await supabase.from('pl_lesson').delete().eq('id', id);
		if (error) throw new Error(error.message);
	}

	async findById(id: string) {
		const { data, error } = await supabase
			.from('pl_lesson')
			.select('*')
			.eq('id', id)
			.single();

		if (error) throw new Error('Lesson not found');
		return data;
	}

	async listByModule(moduleId: string) {
		const { data, error } = await supabase
			.from('pl_lesson')
			.select('*')
			.eq('moduleId', moduleId)
			.order('order', { ascending: true });

		if (error) throw new Error(error.message);
		return data;
	}

	async listByProduct(productId: string) {
		const { data, error } = await supabase
			.from('pl_lesson')
			.select('*')
			.eq('productId', productId)
			.order('order', { ascending: true });

		if (error) throw new Error(error.message);
		return data;
	}
}

export const lessonRepository = new LessonRepository();
