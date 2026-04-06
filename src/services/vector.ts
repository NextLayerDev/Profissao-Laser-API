import { withCapture } from '@/lib/sentry.js';
import { deleteSvgByUrl, uploadSvgFile } from '../lib/storage.js';
import { vectorRepository } from '../repositories/vector.js';
import type { ListVectorsQuery, VectorUpdate } from '../types/vector.js';

export const vectorService = {
	async listVectors(customerId: string, query: ListVectorsQuery) {
		return withCapture(() => vectorRepository.list(customerId, query));
	},

	async getVector(id: string, customerId: string | null) {
		return withCapture(async () => {
			const vector = await vectorRepository.findById(id);
			if (customerId && vector.customer_id !== customerId) {
				throw new Error('Vector not found');
			}
			return vector;
		});
	},

	async createVector(
		customerId: string,
		{ svgContent, originalName }: { svgContent: string; originalName: string },
	) {
		return withCapture(async () => {
			const path = `${customerId}/${Date.now()}_${originalName}.svg`;
			const svgUrl = await uploadSvgFile(svgContent, path);
			return vectorRepository.create(customerId, {
				original_name: originalName,
				svg_url: svgUrl,
			});
		});
	},

	async updateVector(
		id: string,
		customerId: string | null,
		{ svgContent, originalName }: VectorUpdate,
	) {
		return withCapture(async () => {
			const vector = await vectorRepository.findById(id);
			if (customerId && vector.customer_id !== customerId) {
				throw new Error('Unauthorized');
			}

			const fields: { original_name?: string; svg_url?: string } = {};

			if (originalName) fields.original_name = originalName;

			if (svgContent) {
				await deleteSvgByUrl(vector.svg_url);
				const name = originalName ?? vector.original_name;
				const path = `${vector.customer_id}/${Date.now()}_${name}.svg`;
				fields.svg_url = await uploadSvgFile(svgContent, path);
			}

			return vectorRepository.update(id, fields);
		});
	},

	async deleteVector(id: string, customerId: string | null) {
		return withCapture(async () => {
			const vector = await vectorRepository.findById(id);
			if (customerId && vector.customer_id !== customerId) {
				throw new Error('Unauthorized');
			}
			await deleteSvgByUrl(vector.svg_url);
			await vectorRepository.delete(id);
		});
	},
};
