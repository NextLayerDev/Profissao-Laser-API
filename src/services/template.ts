import crypto from 'node:crypto';
import {
	deleteTemplateImageByUrl,
	uploadTemplateImage,
} from '../lib/storage.js';
import { designRepository } from '../repositories/design.js';
import { templateRepository } from '../repositories/template.js';
import type { Design } from '../types/design.js';
import type {
	CloneTemplateInput,
	CreateTemplateInput,
	Template,
	TemplateTipo,
	UpdateTemplateInput,
} from '../types/template.js';

interface ListParams {
	page: number;
	limit: number;
	categoryId?: string;
	tipoImagem?: TemplateTipo;
	tag?: string;
	search?: string;
	status?: 'ativo' | 'inativo';
	includeInactive?: boolean;
}

class TemplateService {
	async list(params: ListParams) {
		const { data, total } = await templateRepository.list(params);
		return { data, total, page: params.page, limit: params.limit };
	}

	async findById(id: string): Promise<Template> {
		return templateRepository.findById(id);
	}

	async create(
		data: CreateTemplateInput,
		createdBy: string | null,
	): Promise<Template> {
		return templateRepository.create({
			...data,
			id: crypto.randomUUID(),
			createdBy,
		});
	}

	async update(id: string, data: UpdateTemplateInput): Promise<Template> {
		// Existência implícita: o repository joga 'Template not found' se não achar
		return templateRepository.update(id, data);
	}

	async uploadImage(
		id: string,
		buffer: Buffer,
		mimetype: string,
		filename: string,
	): Promise<Template> {
		// Garantir que o template existe e pegar URL antiga
		const existing = await templateRepository.findById(id);

		const ext = filename.split('.').pop()?.toLowerCase() || 'png';
		const path = `${id}/${crypto.randomUUID()}.${ext}`;
		const newUrl = await uploadTemplateImage(buffer, path, mimetype);

		const updated = await templateRepository.update(id, { imageUrl: newUrl });

		// Best-effort cleanup da imagem antiga
		if (existing.imageUrl && existing.imageUrl !== newUrl) {
			try {
				await deleteTemplateImageByUrl(existing.imageUrl);
			} catch (err) {
				console.warn('Falha ao remover imagem antiga do template:', err);
			}
		}

		return updated;
	}

	async delete(id: string): Promise<void> {
		const { imageUrl } = await templateRepository.delete(id);
		if (imageUrl) {
			try {
				await deleteTemplateImageByUrl(imageUrl);
			} catch (err) {
				console.warn('Falha ao remover imagem do template:', err);
			}
		}
	}

	async clone(
		templateId: string,
		customerId: string,
		input: CloneTemplateInput,
	): Promise<Design> {
		const template = await templateRepository.findById(templateId);
		if (template.status !== 'ativo') {
			throw new Error('Template not available');
		}

		// Estado inicial do canvas: usar canvasJson do template, ou estrutura mínima
		// com a imagem como background.
		const canvasJson = template.canvasJson ?? {
			version: '6.0.0',
			objects: [],
			background: '#ffffff',
			backgroundImage: {
				type: 'image',
				src: template.imageUrl,
				width: template.width,
				height: template.height,
				selectable: false,
				evented: false,
			},
		};

		return designRepository.create({
			id: crypto.randomUUID(),
			customerId,
			name: input.name ?? `${template.name} (cópia)`,
			templateId: template.id,
			canvasJson,
			width: template.width,
			height: template.height,
			notes: input.notes,
		});
	}
}

export const templateService = new TemplateService();
