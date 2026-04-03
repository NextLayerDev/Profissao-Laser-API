import { withCapture } from '@/lib/sentry.js';
import { moduleRepository } from '../repositories/module.js';
import type { ModuleCreate, ModuleUpdate } from '../types/module.js';

export const moduleService = {
	async create(data: ModuleCreate) {
		return withCapture(async () => {
			const id = crypto.randomUUID();
			return moduleRepository.create({ id, ...data });
		});
	},

	async update(id: string, data: ModuleUpdate) {
		return withCapture(() => moduleRepository.update(id, data));
	},

	async delete(id: string) {
		return withCapture(async () => {
			await moduleRepository.findById(id);
			return moduleRepository.delete(id);
		});
	},

	async listByProduct(productId: string) {
		return withCapture(() => moduleRepository.listByProduct(productId));
	},

	async reorder(moduleIds: string[]) {
		return withCapture(() => moduleRepository.reorder(moduleIds));
	},
};
