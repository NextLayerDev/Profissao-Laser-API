import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	refundInvocation,
	resolveToolBilling,
	settleInvocation,
} from '../lib/upvox-tools.js';
import { parseVectorizeParams } from '../lib/vectorize.js';
import { vectorizeService } from '../services/vectorize.js';

export const vectorizeController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	// Billing is OPTIONAL and owned by upvox: if the tool has a funcionalidade the
	// front invokes first (debits) and sends an invocation_id → we validate, run,
	// and settle/refund. If it's not billed for this customer → run free. A request
	// without an id for a *billed* tool is rejected (no free bypass).
	const customerId = request.currentCustomer?.id;
	const authHeader = request.headers.authorization;
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

		const gate = await resolveToolBilling(
			customerId,
			'vectorize',
			fields.invocation_id ?? null,
			authHeader,
		);
		if (gate.mode === 'reject') {
			return reply.status(gate.status).send({ message: gate.message });
		}
		invocationId = gate.mode === 'paid' ? gate.invocationId : null;

		const params = parseVectorizeParams(fields);
		const { data: result, error } = await vectorizeService.vectorize(
			customerId,
			{ buffer: fileBuffer, filename, mimetype, params },
		);

		if (error) {
			if (invocationId)
				await refundInvocation(customerId, invocationId, authHeader);
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(500).send({ message });
		}

		if (invocationId)
			await settleInvocation(customerId, invocationId, authHeader);
		return reply.status(201).send(result);
	} catch (err) {
		if (invocationId && customerId)
			await refundInvocation(customerId, invocationId, authHeader);
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
