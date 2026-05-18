import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseFormBoolean } from '../lib/vectorize.js';
import { creditService } from '../services/credit.js';
import { vectorizeService } from '../services/vectorize.js';
import type { VectorizeParams } from '../types/vector.js';
import { mapCreditError } from './credit.js';

function extractParams(fields: Record<string, string>): VectorizeParams {
	return {
		mode: (fields.mode as VectorizeParams['mode']) ?? 'detalhado',
		detailLevel:
			fields.detailLevel !== undefined ? Number(fields.detailLevel) : 50,
		smoothing: fields.smoothing !== undefined ? Number(fields.smoothing) : 0,
		noiseReduction:
			fields.noiseReduction !== undefined ? Number(fields.noiseReduction) : 0,
		blackAndWhite: parseFormBoolean(fields.blackAndWhite),
		invertColors: parseFormBoolean(fields.invertColors),
	};
}

export const vectorizeController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}

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

		if (!fileBuffer) {
			return reply.status(400).send({ message: 'File is required' });
		}

		// useCredits arrives as a multipart form field string
		const confirmed = fields.useCredits === 'true';
		let creditHandle: { refund: () => Promise<void> } | null = null;
		try {
			creditHandle = await creditService.charge({
				customerId,
				feature: 'vectorize',
				idempotencyKey: `vectorize:${customerId}:${crypto.randomUUID()}`,
				confirmed,
			});
		} catch (err) {
			return mapCreditError(err, reply);
		}

		try {
			const params = extractParams(fields);
			const { data: result, error } = await vectorizeService.vectorize(
				customerId,
				{ buffer: fileBuffer, filename, mimetype, params },
			);

			if (error) {
				await creditHandle.refund();
				const message =
					error instanceof Error ? error.message : 'Unknown error';
				return reply.status(500).send({ message });
			}

			return reply.status(201).send(result);
		} catch (err) {
			await creditHandle.refund();
			const message = err instanceof Error ? err.message : 'Unknown error';
			return reply.status(500).send({ message });
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const vectorizeBatchController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id;
		if (!customerId) {
			return reply.status(403).send({ message: 'Customer not found' });
		}

		const fileParts: Array<{
			buffer: Buffer;
			filename: string;
			mimetype: string;
		}> = [];
		const fields: Record<string, string> = {};

		for await (const part of request.parts()) {
			if (part.type === 'file') {
				const buffer = await part.toBuffer();
				fileParts.push({
					buffer,
					filename: part.filename ?? 'image',
					mimetype: part.mimetype,
				});
			} else {
				fields[part.fieldname] = part.value as string;
			}
		}

		if (fileParts.length === 0) {
			return reply
				.status(400)
				.send({ message: 'At least one file is required' });
		}

		// useCredits arrives as a multipart form field string
		const confirmed = fields.useCredits === 'true';
		let creditHandle: { refund: () => Promise<void> } | null = null;
		try {
			creditHandle = await creditService.charge({
				customerId,
				feature: 'vectorize',
				idempotencyKey: `vectorize:${customerId}:${crypto.randomUUID()}`,
				confirmed,
			});
		} catch (err) {
			return mapCreditError(err, reply);
		}

		try {
			const params = extractParams(fields);
			const inputs = fileParts.map((f) => ({ ...f, params }));

			const { data: result, error } = await vectorizeService.vectorizeBatch(
				customerId,
				inputs,
			);

			if (error) {
				await creditHandle.refund();
				const message =
					error instanceof Error ? error.message : 'Unknown error';
				return reply.status(500).send({ message });
			}

			return reply.status(201).send(result);
		} catch (err) {
			await creditHandle.refund();
			const message = err instanceof Error ? err.message : 'Unknown error';
			return reply.status(500).send({ message });
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};

export const exportVectorController = async (
	request: FastifyRequest<{
		Params: { format: string };
		Querystring: { id: string };
	}>,
	reply: FastifyReply,
) => {
	try {
		const customerId = request.currentCustomer?.id ?? null;
		const { format } = request.params;
		const { id } = request.query;

		if (!id) {
			return reply.status(400).send({ message: 'id query param is required' });
		}
		if (format !== 'dxf' && format !== 'png') {
			return reply.status(400).send({ message: 'format must be dxf or png' });
		}

		const { data: result, error } = await vectorizeService.exportVector(
			id,
			customerId,
			format,
		);

		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			const status = message === 'Vector not found' ? 404 : 500;
			return reply.status(status).send({ message });
		}

		if (result?.type === 'redirect') {
			return reply.redirect(result.url);
		}

		return reply
			.header(
				'Content-Disposition',
				`attachment; filename="${result?.filename}"`,
			)
			.header('Content-Type', result?.mimetype)
			.send(result?.content);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
};
