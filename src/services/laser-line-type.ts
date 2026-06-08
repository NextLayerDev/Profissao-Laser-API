import crypto from 'node:crypto';
import {
	deleteLaserLineTypeImageByUrl,
	uploadLaserLineTypeImage,
} from '../lib/storage.js';
import { laserLineTypeRepository } from '../repositories/laser-line-type.js';
import type {
	LaserLineType,
	LaserLineTypeSoftware,
	UpdateLaserLineType,
} from '../types/laser-line-type.js';

interface CreateInput {
	software: LaserLineTypeSoftware;
	name: string;
	order: number;
	file?: { buffer: Buffer; filename: string; mimetype: string };
}

class LaserLineTypeService {
	list(software?: LaserLineTypeSoftware) {
		return laserLineTypeRepository.list(software);
	}

	async create(input: CreateInput): Promise<LaserLineType> {
		let imageUrl: string | null = null;
		if (input.file) {
			const ext = input.file.filename.split('.').pop() ?? 'png';
			const path = `${input.software}/${crypto.randomUUID()}.${ext}`;
			imageUrl = await uploadLaserLineTypeImage(
				input.file.buffer,
				path,
				input.file.mimetype,
			);
		}
		return laserLineTypeRepository.create({
			software: input.software,
			name: input.name,
			imageUrl,
			order: input.order,
		});
	}

	async update(
		id: string,
		patch: UpdateLaserLineType,
		file?: { buffer: Buffer; filename: string; mimetype: string },
	): Promise<LaserLineType> {
		let newImageUrl: string | undefined;
		if (file) {
			const existing = await laserLineTypeRepository.findById(id);
			const ext = file.filename.split('.').pop() ?? 'png';
			const path = `${patch.software ?? existing.software}/${crypto.randomUUID()}.${ext}`;
			newImageUrl = await uploadLaserLineTypeImage(
				file.buffer,
				path,
				file.mimetype,
			);
			// Best-effort delete da imagem antiga
			if (existing.imageUrl) {
				try {
					await deleteLaserLineTypeImageByUrl(existing.imageUrl);
				} catch {
					// ignore
				}
			}
		}
		const updated = await laserLineTypeRepository.update(id, {
			...patch,
			...(newImageUrl !== undefined && { imageUrl: newImageUrl }),
		} as UpdateLaserLineType & { imageUrl?: string });
		return updated;
	}

	async delete(id: string): Promise<void> {
		const { imageUrl } = await laserLineTypeRepository.delete(id);
		if (imageUrl) {
			try {
				await deleteLaserLineTypeImageByUrl(imageUrl);
			} catch {
				// ignore — registro já foi removido
			}
		}
	}
}

export const laserLineTypeService = new LaserLineTypeService();
