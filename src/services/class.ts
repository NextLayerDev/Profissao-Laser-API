import { classRepository } from '../repositories/class.js';
import type { ClassCreate, ClassUpdate } from '../types/class.js';

class ClassService {
	async listClasses() {
		return await classRepository.listAll();
	}

	async createClass(data: ClassCreate) {
		return await classRepository.create(data);
	}

	async updateClass(id: string, data: ClassUpdate) {
		return await classRepository.update(id, data);
	}

	async deleteClass(id: string) {
		return await classRepository.delete(id);
	}

	async addProduct(classId: string, productId: string) {
		return await classRepository.addProduct(classId, productId);
	}

	async removeProduct(classId: string, productId: string) {
		return await classRepository.removeProduct(classId, productId);
	}
}

export const classService = new ClassService();
