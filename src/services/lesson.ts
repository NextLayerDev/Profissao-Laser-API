import { withCapture } from '@/lib/sentry.js';
import { lessonRepository } from '../repositories/lesson.js';
import type { LessonCreate, LessonUpdate } from '../types/lesson.js';

export const lessonService = {
	async create(data: LessonCreate) {
		return withCapture(async () => {
			const id = crypto.randomUUID();
			return lessonRepository.create({ id, ...data });
		});
	},

	async update(id: string, data: LessonUpdate) {
		return withCapture(() => lessonRepository.update(id, data));
	},

	async delete(id: string) {
		return withCapture(async () => {
			await lessonRepository.findById(id);
			return lessonRepository.delete(id);
		});
	},

	async listByModule(moduleId: string) {
		return withCapture(() => lessonRepository.listByModule(moduleId));
	},

	async reorder(lessonIds: string[]) {
		return withCapture(() => lessonRepository.reorder(lessonIds));
	},
};
