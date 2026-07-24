import type { FastifyReply, FastifyRequest } from 'fastify';
import { isStaffRole } from '../lib/external-auth.js';
import { imageSizePresetRepository } from '../repositories/image-size-preset.js';
import {
	createImageSizePresetSchema,
	updateImageSizePresetSchema,
} from '../types/image-size-preset.js';

interface IdParams {
	id: string;
}

async function requireAdmin(
	request: FastifyRequest,
	reply: FastifyReply,
): Promise<boolean> {
	if (!request.currentUser) {
		reply.status(401).send({
			statusCode: 401,
			error: 'Unauthorized',
			message: 'Not authenticated',
		});
		return false;
	}
	if (!isStaffRole(request.currentRole)) {
		reply.status(403).send({
			statusCode: 403,
			error: 'Forbidden',
			message: 'Admin access required',
		});
		return false;
	}
	return true;
}

export const listImageSizePresetsController = async (
	_request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const presets = await imageSizePresetRepository.list();
		return reply.send(presets);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const createImageSizePresetController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const input = createImageSizePresetSchema.parse(request.body);
		const preset = await imageSizePresetRepository.create(input);
		return reply.status(201).send(preset);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateImageSizePresetController = async (
	request: FastifyRequest<{ Params: IdParams }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		const input = updateImageSizePresetSchema.parse(request.body);
		const preset = await imageSizePresetRepository.update(
			request.params.id,
			input,
		);
		return reply.send(preset);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const deleteImageSizePresetController = async (
	request: FastifyRequest<{ Params: IdParams }>,
	reply: FastifyReply,
) => {
	if (!(await requireAdmin(request, reply))) return;
	try {
		await imageSizePresetRepository.remove(request.params.id);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};
