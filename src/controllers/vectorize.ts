import type { FastifyReply, FastifyRequest } from 'fastify';
import { UpvoxApiError } from '../lib/upvox-client.js';
import { reserveUpvoxTool } from '../lib/upvox-guard.js';
import { replyUpvoxError } from '../lib/upvox-reply.js';
import { parseFormBoolean } from '../lib/vectorize.js';
import { vectorizeService } from '../services/vectorize.js';
import type { VectorizeParams } from '../types/vector.js';

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

function requireUpvoxFields(
	fields: Record<string, string>,
	reply: FastifyReply,
): { toolKey: string; courseSlug: string } | null {
	const toolKey = fields.toolKey;
	const courseSlug = fields.courseSlug;
	if (!toolKey || !courseSlug) {
		reply
			.status(400)
			.send({ message: 'toolKey e courseSlug são obrigatórios' });
		return null;
	}
	return { toolKey, courseSlug };
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
		const jwt = request.headers.authorization ?? '';
		if (!jwt) {
			return reply
				.status(401)
				.send({ message: 'Missing Authorization header' });
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

		const upvoxFields = requireUpvoxFields(fields, reply);
		if (!upvoxFields) return;

		let usage: Awaited<ReturnType<typeof reserveUpvoxTool>>;
		try {
			usage = await reserveUpvoxTool({
				jwt,
				customerId,
				toolKey: upvoxFields.toolKey,
				courseSlug: upvoxFields.courseSlug,
				unlimited: request.isUnlimitedCustomer,
			});
		} catch (err) {
			return replyUpvoxError(err, reply);
		}

		try {
			const params = extractParams(fields);
			const { data: result, error } = await vectorizeService.vectorize(
				customerId,
				{ buffer: fileBuffer, filename, mimetype, params },
			);

			if (error) {
				const message =
					error instanceof Error ? error.message : 'Unknown error';
				await usage.rollback(`vectorize: ${message}`);
				return reply.status(500).send({ message });
			}

			await usage.commit();
			return reply.status(201).send(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			await usage.rollback(`vectorize: ${message}`);
			return reply.status(500).send({ message });
		}
	} catch (err) {
		if (err instanceof UpvoxApiError) return replyUpvoxError(err, reply);
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
		const jwt = request.headers.authorization ?? '';
		if (!jwt) {
			return reply
				.status(401)
				.send({ message: 'Missing Authorization header' });
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

		const upvoxFields = requireUpvoxFields(fields, reply);
		if (!upvoxFields) return;

		let usage: Awaited<ReturnType<typeof reserveUpvoxTool>>;
		try {
			usage = await reserveUpvoxTool({
				jwt,
				customerId,
				toolKey: upvoxFields.toolKey,
				courseSlug: upvoxFields.courseSlug,
				unlimited: request.isUnlimitedCustomer,
			});
		} catch (err) {
			return replyUpvoxError(err, reply);
		}

		try {
			const params = extractParams(fields);
			const inputs = fileParts.map((f) => ({ ...f, params }));

			const { data: result, error } = await vectorizeService.vectorizeBatch(
				customerId,
				inputs,
			);

			if (error) {
				const message =
					error instanceof Error ? error.message : 'Unknown error';
				await usage.rollback(`vectorizeBatch: ${message}`);
				return reply.status(500).send({ message });
			}

			await usage.commit();
			return reply.status(201).send(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			await usage.rollback(`vectorizeBatch: ${message}`);
			return reply.status(500).send({ message });
		}
	} catch (err) {
		if (err instanceof UpvoxApiError) return replyUpvoxError(err, reply);
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
