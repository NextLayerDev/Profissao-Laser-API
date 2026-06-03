import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	getInvocation,
	refundInvocation,
	settleInvocation,
} from '../lib/upvox-tools.js';
import { parseVectorizeParams } from '../lib/vectorize.js';
import { vectorizeService } from '../services/vectorize.js';

export const vectorizeController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	// Billing is owned by upvox: the front calls /v1/tool/vectorize/invoke first
	// (which debits/quota and returns an invocation_id), then sends it here. We
	// validate it, run the engine, and settle (success) or refund (failure) —
	// authenticating to upvox with the gateway-validated customer id (x-user-id)
	// so upvox scopes every call to the owner.
	const customerId = request.currentCustomer?.id;
	let invocationId: string | null = null;

	try {
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

		invocationId = fields.invocation_id ?? null;
		if (!invocationId) {
			return reply.status(400).send({ message: 'invocation_id is required' });
		}

		// Authorize: a pending `vectorize` invocation owned by this customer.
		// Prevents calling the engine for free (no valid paid invocation = reject).
		const inv = await getInvocation(customerId, invocationId);
		if (
			!inv ||
			inv.status !== 'pending' ||
			inv.tool_key !== 'vectorize' ||
			inv.customer_id !== customerId
		) {
			invocationId = null; // not ours to refund
			return reply.status(403).send({ message: 'invalid_invocation' });
		}

		const params = parseVectorizeParams(fields);
		const { data: result, error } = await vectorizeService.vectorize(
			customerId,
			{ buffer: fileBuffer, filename, mimetype, params },
		);

		if (error) {
			await refundInvocation(customerId, invocationId);
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(500).send({ message });
		}

		await settleInvocation(customerId, invocationId);
		return reply.status(201).send(result);
	} catch (err) {
		if (invocationId && customerId)
			await refundInvocation(customerId, invocationId);
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

		const params = parseVectorizeParams(fields);
		const inputs = fileParts.map((f) => ({ ...f, params }));

		const { data: result, error } = await vectorizeService.vectorizeBatch(
			customerId,
			inputs,
		);

		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(500).send({ message });
		}

		return reply.status(201).send(result);
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
