import { lessonRepository } from '../repositories/lesson.js';
import type { LessonCreate, LessonUpdate } from '../types/lesson.js';

class LessonService {
	async create(data: LessonCreate) {
		const id = crypto.randomUUID();
		return await lessonRepository.create({ id, ...data });
	}

	async update(id: string, data: LessonUpdate) {
		return await lessonRepository.update(id, data);
	}

	async delete(id: string) {
		await lessonRepository.findById(id);
		return await lessonRepository.delete(id);
	}

	async listByModule(moduleId: string) {
		return await lessonRepository.listByModule(moduleId);
	}
}

export const lessonService = new LessonService();
