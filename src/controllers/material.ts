import type { FastifyReply, FastifyRequest } from 'fastify';
import { uploadMaterialFile } from '../lib/storage.js';
import { materialRepository } from '../repositories/material.js';
import type { MaterialType } from '../types/material.js';

const MIME_TO_TYPE: Record<string, MaterialType> = {
	'application/pdf': 'pdf',
	'application/msword': 'word',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
		'word',
	'application/vnd.oasis.opendocument.text': 'odt',
};

function detectType(mimetype: string): MaterialType {
	if (mimetype.startsWith('image/')) return 'image';
	return MIME_TO_TYPE[mimetype] ?? 'pdf';
}

export const listMaterialsController = async (
	request: FastifyRequest<{ Params: { lessonId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const materials = await materialRepository.listByLesson(
			request.params.lessonId,
		);
		return reply.send(materials);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const uploadMaterialController = async (
	request: FastifyRequest<{ Params: { lessonId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = await request.file();
		if (!data) return reply.status(400).send({ message: 'No file provided' });

		const buffer = await data.toBuffer();
		const type = detectType(data.mimetype);
		const ext = data.filename.split('.').pop() ?? '';
		const storagePath = `${request.params.lessonId}/${crypto.randomUUID()}.${ext}`;

		const url = await uploadMaterialFile(buffer, storagePath, data.mimetype);

		const name = data.fields.name
			? (data.fields.name as { value: string }).value
			: data.filename;

		const material = await materialRepository.create(request.params.lessonId, {
			name,
			url,
			type,
		});

		return reply.status(201).send(material);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const uploadLessonFileController = async (
	request: FastifyRequest<{ Params: { lessonId: string } }>,
	reply: FastifyReply,
) => {
	try {
		const data = await request.file();
		if (!data) return reply.status(400).send({ message: 'No file provided' });

		const buffer = await data.toBuffer();
		const type = detectType(data.mimetype);
		const ext = data.filename.split('.').pop() ?? 'bin';
		const storagePath = `${request.params.lessonId}/files/${crypto.randomUUID()}.${ext}`;

		const url = await uploadMaterialFile(buffer, storagePath, data.mimetype);

		const name = data.fields.name
			? (data.fields.name as { value: string }).value
			: data.filename;

		const material = await materialRepository.create(request.params.lessonId, {
			name,
			url,
			type,
		});

		return reply.status(201).send(material);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const deleteMaterialController = async (
	request: FastifyRequest<{ Params: { lessonId: string; materialId: string } }>,
	reply: FastifyReply,
) => {
	try {
		await materialRepository.delete(
			request.params.lessonId,
			request.params.materialId,
		);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Material not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};
