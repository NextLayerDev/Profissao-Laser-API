import type { FastifyReply, FastifyRequest } from 'fastify';
import { laserLineTypeService } from '../services/laser-line-type.js';
import {
	createLaserLineTypeFieldsSchema,
	type LaserLineTypeSoftware,
	updateLaserLineTypeSchema,
} from '../types/laser-line-type.js';

export const listLaserLineTypesController = async (
	request: FastifyRequest<{
		Querystring: { software?: LaserLineTypeSoftware };
	}>,
	reply: FastifyReply,
) => {
	try {
		const list = await laserLineTypeService.list(request.query.software);
		return reply.send(list);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createLaserLineTypeController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		let fileBuffer: Buffer | null = null;
		let filename = 'image';
		let mimetype = 'application/octet-stream';
		const fields: Record<string, string> = {};

		for await (const part of request.parts()) {
			if (part.type === 'file') {
				fileBuffer = await part.toBuffer();
				filename = part.filename ?? 'image';
				mimetype = part.mimetype;
			} else {
				fields[part.fieldname] = part.value as string;
			}
		}

		const parsed = createLaserLineTypeFieldsSchema.parse(fields);
		const lineType = await laserLineTypeService.create({
			software: parsed.software,
			name: parsed.name,
			order: parsed.order,
			file: fileBuffer ? { buffer: fileBuffer, filename, mimetype } : undefined,
		});
		return reply.status(201).send(lineType);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateLaserLineTypeController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		// Aceita multipart (caso queira trocar imagem) ou JSON puro
		const isMultipart = request.isMultipart?.() ?? false;
		let fileBuffer: Buffer | null = null;
		let filename = 'image';
		let mimetype = 'application/octet-stream';
		let fields: Record<string, string> = {};

		if (isMultipart) {
			for await (const part of request.parts()) {
				if (part.type === 'file') {
					fileBuffer = await part.toBuffer();
					filename = part.filename ?? 'image';
					mimetype = part.mimetype;
				} else {
					fields[part.fieldname] = part.value as string;
				}
			}
		} else {
			fields = request.body as Record<string, string>;
		}

		const parsed = updateLaserLineTypeSchema.parse(fields);
		const updated = await laserLineTypeService.update(
			request.params.id,
			parsed,
			fileBuffer ? { buffer: fileBuffer, filename, mimetype } : undefined,
		);
		return reply.send(updated);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'LineType not found' ? 404 : 400;
		return reply.status(status).send({ message });
	}
};

export const deleteLaserLineTypeController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		await laserLineTypeService.delete(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		const status = message === 'LineType not found' ? 404 : 500;
		return reply.status(status).send({ message });
	}
};
