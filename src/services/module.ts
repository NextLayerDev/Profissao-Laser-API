import { moduleRepository } from '../repositories/module.js';
import type { ModuleCreate, ModuleUpdate } from '../types/module.js';

class ModuleService {
	async create(data: ModuleCreate) {
		const id = crypto.randomUUID();
		return await moduleRepository.create({ id, ...data });
	}

	async update(id: string, data: ModuleUpdate) {
		return await moduleRepository.update(id, data);
	}

	async delete(id: string) {
		await moduleRepository.findById(id);
		return await moduleRepository.delete(id);
	}

	async listByProduct(productId: string) {
		return await moduleRepository.listByProduct(productId);
	}
}

export const moduleService = new ModuleService();
