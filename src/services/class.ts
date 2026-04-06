import { withCapture } from '@/lib/sentry.js';
import { classRepository } from '../repositories/class.js';
import type { ClassCreate, ClassUpdate } from '../types/class.js';

export const classService = {
	async listClasses() {
		return withCapture(() => classRepository.listAll());
	},

	async getClassById(id: string) {
		return withCapture(() => classRepository.findById(id));
	},

	async createClass(data: ClassCreate) {
		return withCapture(() => classRepository.create(data));
	},

	async updateClass(id: string, data: ClassUpdate) {
		return withCapture(() => classRepository.update(id, data));
	},

	async deleteClass(id: string) {
		return withCapture(() => classRepository.delete(id));
	},

	async addProduct(classId: string, productId: string) {
		return withCapture(() => classRepository.addProduct(classId, productId));
	},

	async removeProduct(classId: string, productId: string) {
		return withCapture(() => classRepository.removeProduct(classId, productId));
	},
};
