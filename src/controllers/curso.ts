import type { FastifyReply, FastifyRequest } from 'fastify';
import { uploadCourseImage } from '../lib/storage.js';
import { cursoRepository } from '../repositories/curso.js';
import { cursoService } from '../services/curso.js';
import {
	createCursoSchema,
	updateCursoSchema,
	updateCursoStatusSchema,
} from '../types/curso.js';

export const getCursosController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	const { data, error } = await cursoService.listCursos();
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(data);
};

export const getCursoByIdController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { data, error } = await cursoService.getCursoById(request.params.id);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Curso not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.send(data);
};

export const createCursoController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const data = createCursoSchema.parse(request.body);
	const { data: curso, error } = await cursoService.createCurso(data);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.status(201).send(curso);
};

export const updateCursoController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const data = updateCursoSchema.parse(request.body);
	const { data: curso, error } = await cursoService.updateCurso(
		request.params.id,
		data,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Curso not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.send(curso);
};

export const updateCursoStatusController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { active } = updateCursoStatusSchema.parse(request.body);
	const { data: curso, error } = await cursoService.updateCursoStatus(
		request.params.id,
		active,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Curso not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.send(curso);
};

export const updateCursoFormController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const parts = request.parts();

		const fields: Record<string, string> = {};
		let fileBuffer: Buffer | null = null;
		let fileMimetype = 'image/jpeg';
		let fileExt = 'jpg';

		for await (const part of parts) {
			if (part.type === 'file') {
				fileBuffer = await part.toBuffer();
				fileMimetype = part.mimetype;
				fileExt = part.filename.split('.').pop() ?? 'jpg';
			} else {
				fields[part.fieldname] = part.value as string;
			}
		}

		const data: import('../types/curso.js').CursoUpdate = {};
		if (fields.name) data.name = fields.name;
		if (fields.description) data.description = fields.description;
		if (fields.price) data.price = Number(fields.price);

		const { data: updatedCurso, error: updateError } =
			await cursoService.updateCurso(request.params.id, data);
		if (updateError) {
			const message =
				updateError instanceof Error ? updateError.message : 'Unknown error';
			const status = message === 'Curso not found' ? 404 : 500;
			return reply.status(status).send({ message });
		}

		let curso = updatedCurso;

		if (fileBuffer) {
			const storagePath = `cursos/${request.params.id}/${crypto.randomUUID()}.${fileExt}`;
			const url = await uploadCourseImage(
				fileBuffer,
				storagePath,
				fileMimetype,
			);
			curso = await cursoRepository.updateImage(request.params.id, url);
		}

		return reply.send(curso);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Curso not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const uploadCursoImageController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const file = await request.file();
		if (!file) return reply.status(400).send({ message: 'No file provided' });

		const buffer = await file.toBuffer();
		const ext = file.filename.split('.').pop() ?? 'jpg';
		const storagePath = `cursos/${request.params.id}/${crypto.randomUUID()}.${ext}`;

		const url = await uploadCourseImage(buffer, storagePath, file.mimetype);
		const curso = await cursoRepository.updateImage(request.params.id, url);

		return reply.send(curso);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'Curso not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};

export const deleteCursoController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	const { error } = await cursoService.deleteCurso(request.params.id);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const status = message === 'Curso not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
	return reply.status(204).send();
};
