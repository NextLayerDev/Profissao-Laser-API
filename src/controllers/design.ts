import type { FastifyReply, FastifyRequest } from 'fastify';
import { designService } from '../services/design.js';
import { createDesignSchema, updateDesignSchema } from '../types/design.js';

function statusFor(message: string): number {
	if (message === 'Design not found') return 404;
	return 500;
}

export const listDesignsController = async (
	request: FastifyRequest<{
		Querystring: {
			page?: number;
			limit?: number;
			templateId?: string;
			search?: string;
		};
	}>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const page = request.query.page ?? 1;
		const limit = request.query.limit ?? 20;
		const result = await designService.list({
			customerId,
			page,
			limit,
			templateId: request.query.templateId,
			search: request.query.search,
		});
		return reply.send(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const getDesignController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const design = await designService.findById(request.params.id, customerId);
		return reply.send(design);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const createDesignController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const data = createDesignSchema.parse(request.body);
		const design = await designService.create(customerId, data);
		return reply.status(201).send(design);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(400).send({ message });
	}
};

export const updateDesignController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const data = updateDesignSchema.parse(request.body);
		const design = await designService.update(
			request.params.id,
			customerId,
			data,
		);
		return reply.send(design);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const uploadDesignThumbnailController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const file = await request.file();
		if (!file) {
			return reply.status(400).send({ message: 'File is required' });
		}
		const buffer = await file.toBuffer();
		const design = await designService.uploadThumbnail(
			request.params.id,
			customerId,
			buffer,
			file.mimetype,
			file.filename ?? 'thumb.png',
		);
		return reply.send(design);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};

export const deleteDesignController = async (
	request: FastifyRequest<{ Params: { id: string } }>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		await designService.delete(request.params.id, customerId);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(statusFor(message)).send({ message });
	}
};
