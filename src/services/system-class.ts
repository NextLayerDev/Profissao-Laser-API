import { withCapture } from '@/lib/sentry.js';
import { systemClassRepository } from '../repositories/system-class.js';
import type {
	SystemClassCreate,
	SystemClassUpdate,
} from '../types/system-class.js';

export const systemClassService = {
	async listSystemClasses() {
		return withCapture(() => systemClassRepository.listAll());
	},

	async getSystemClassById(id: string) {
		return withCapture(() => systemClassRepository.findById(id));
	},

	async createSystemClass(data: SystemClassCreate) {
		return withCapture(() => systemClassRepository.create(data));
	},

	async updateSystemClass(id: string, data: SystemClassUpdate) {
		return withCapture(() => systemClassRepository.update(id, data));
	},

	async deleteSystemClass(id: string) {
		return withCapture(() => systemClassRepository.delete(id));
	},

	async addProduct(systemClassId: string, productId: string) {
		return withCapture(() =>
			systemClassRepository.addProduct(systemClassId, productId),
		);
	},

	async removeProduct(systemClassId: string, productId: string) {
		return withCapture(() =>
			systemClassRepository.removeProduct(systemClassId, productId),
		);
	},

	async addClass(systemClassId: string, classId: string) {
		return withCapture(() =>
			systemClassRepository.addClass(systemClassId, classId),
		);
	},

	async removeClass(systemClassId: string, classId: string) {
		return withCapture(() =>
			systemClassRepository.removeClass(systemClassId, classId),
		);
	},
};
