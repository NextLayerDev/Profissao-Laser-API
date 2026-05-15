import crypto from 'node:crypto';
import { vectorizeHelpRepository } from '../repositories/vectorize-help.js';
import type {
	CreateVectorizeHelpInput,
	UpdateVectorizeHelpInput,
	VectorizeHelp,
} from '../types/vectorize-help.js';

class VectorizeHelpService {
	async listAll(): Promise<VectorizeHelp[]> {
		return vectorizeHelpRepository.listAll();
	}

	async listActive(): Promise<VectorizeHelp[]> {
		return vectorizeHelpRepository.listActive();
	}

	async findById(id: string): Promise<VectorizeHelp> {
		return vectorizeHelpRepository.findById(id);
	}

	async create(data: CreateVectorizeHelpInput): Promise<VectorizeHelp> {
		// `order` é auto-increment: se não veio no body, coloca no fim da lista.
		const order = data.order ?? (await vectorizeHelpRepository.countAll());
		return vectorizeHelpRepository.create({
			...data,
			id: crypto.randomUUID(),
			order,
		});
	}

	async update(
		id: string,
		data: UpdateVectorizeHelpInput,
	): Promise<VectorizeHelp> {
		return vectorizeHelpRepository.update(id, data);
	}

	async delete(id: string): Promise<void> {
		return vectorizeHelpRepository.delete(id);
	}

	/** Reordena e devolve a lista completa já na nova ordem. */
	async reorder(ids: string[]): Promise<VectorizeHelp[]> {
		await vectorizeHelpRepository.reorder(ids);
		return vectorizeHelpRepository.listAll();
	}
}

export const vectorizeHelpService = new VectorizeHelpService();
