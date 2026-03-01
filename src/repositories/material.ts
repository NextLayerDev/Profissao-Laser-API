import { supabase } from '../lib/supabase.js';
import type { MaterialCreate } from '../types/material.js';

class MaterialRepository {
	async listByLesson(lessonId: string) {
		const { data, error } = await supabase
			.from('pl_lesson_material')
			.select('*')
			.eq('lessonId', lessonId)
			.order('createdAt', { ascending: true });

		if (error) throw new Error(error.message);
		return data;
	}

	async create(lessonId: string, data: MaterialCreate) {
		const { data: material, error } = await supabase
			.from('pl_lesson_material')
			.insert({
				id: crypto.randomUUID(),
				lessonId,
				...data,
				createdAt: new Date().toISOString(),
			})
			.select()
			.single();

		if (error) throw new Error(error.message);
		return material;
	}

	async delete(lessonId: string, materialId: string) {
		const { data, error: findError } = await supabase
			.from('pl_lesson_material')
			.select('id')
			.eq('id', materialId)
			.eq('lessonId', lessonId)
			.single();

		if (findError || !data) throw new Error('Material not found');

		const { error } = await supabase
			.from('pl_lesson_material')
			.delete()
			.eq('id', materialId);

		if (error) throw new Error(error.message);
	}
}

export const materialRepository = new MaterialRepository();
