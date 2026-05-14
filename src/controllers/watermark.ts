import type { FastifyReply, FastifyRequest } from 'fastify';
import { customerWatermarkService } from '../services/watermark.js';

export const getWatermarkController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		const watermark = await customerWatermarkService.findByCustomer(customerId);
		if (!watermark) {
			return reply.status(404).send({ message: "Marca d'água não cadastrada" });
		}
		return reply.send(watermark);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const putWatermarkController = async (
	request: FastifyRequest,
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
		const watermark = await customerWatermarkService.upload(
			customerId,
			buffer,
			file.mimetype,
			file.filename ?? 'watermark.png',
		);
		return reply.send(watermark);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const deleteWatermarkController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}
		await customerWatermarkService.delete(customerId);
		return reply.status(204).send();
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
