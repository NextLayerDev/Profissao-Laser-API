import { systemClassRepository } from '../repositories/system-class.js';
import type {
	SystemClassCreate,
	SystemClassUpdate,
} from '../types/system-class.js';

class SystemClassService {
	async listSystemClasses() {
		return await systemClassRepository.listAll();
	}

	async getSystemClassById(id: string) {
		return await systemClassRepository.findById(id);
	}

	async createSystemClass(data: SystemClassCreate) {
		return await systemClassRepository.create(data);
	}

	async updateSystemClass(id: string, data: SystemClassUpdate) {
		return await systemClassRepository.update(id, data);
	}

	async deleteSystemClass(id: string) {
		return await systemClassRepository.delete(id);
	}

	async addProduct(systemClassId: string, productId: string) {
		return await systemClassRepository.addProduct(systemClassId, productId);
	}

	async removeProduct(systemClassId: string, productId: string) {
		return await systemClassRepository.removeProduct(systemClassId, productId);
	}

	async addClass(systemClassId: string, classId: string) {
		return await systemClassRepository.addClass(systemClassId, classId);
	}

	async removeClass(systemClassId: string, classId: string) {
		return await systemClassRepository.removeClass(systemClassId, classId);
	}
}

export const systemClassService = new SystemClassService();
