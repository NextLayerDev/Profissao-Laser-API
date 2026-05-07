import type { FastifyReply, FastifyRequest } from 'fastify';
import { vectorizeService } from '../services/vectorize.js';
import type { VectorizeBatch, VectorizeParams } from '../types/vector.js';

function parseParam<T>(value: string | undefined, parser: (v: string) => T) {
	if (value === undefined) return undefined;
	return parser(value);
}

export const vectorizeController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId)
		return reply.status(401).send({ message: 'Not authenticated' });

	const parts = request.parts();
	let fileBuffer: Buffer | undefined;
	let mimetype = 'application/octet-stream';
	let filename = 'image';
	const params: Partial<VectorizeParams> = {};

	for await (const part of parts) {
		if (part.type === 'file' && part.fieldname === 'file') {
			fileBuffer = await part.toBuffer();
			mimetype = part.mimetype;
			filename = part.filename ?? 'image';
		} else if (part.type === 'field') {
			const value = part.value as string;
			switch (part.fieldname) {
				case 'mode':
					params.mode = value as VectorizeParams['mode'];
					break;
				case 'detailLevel':
					params.detailLevel = parseParam(value, Number);
					break;
				case 'smoothing':
					params.smoothing = parseParam(value, Number);
					break;
				case 'noiseReduction':
					params.noiseReduction = parseParam(value, Number);
					break;
				case 'blackAndWhite':
					params.blackAndWhite = value === 'true';
					break;
				case 'invertColors':
					params.invertColors = value === 'true';
					break;
			}
		}
	}

	if (!fileBuffer)
		return reply.status(400).send({ message: 'File is required' });

	const { data, error } = await vectorizeService.vectorize(
		customerId,
		fileBuffer,
		mimetype,
		filename,
		params,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(data);
};

export const vectorizeBatchController = async (
	request: FastifyRequest<{ Body: VectorizeBatch }>,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id;
	if (!customerId)
		return reply.status(401).send({ message: 'Not authenticated' });

	const { files, params } = request.body;
	const decoded = files.map((f) => ({
		name: f.name,
		buffer: Buffer.from(f.content, 'base64'),
		mimetype: 'image/png',
	}));

	const { data, error } = await vectorizeService.vectorizeBatch(
		customerId,
		decoded,
		params,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	return reply.send(data);
};

export const vectorizeExportController = async (
	request: FastifyRequest<{
		Params: { format: 'svg' | 'dxf' | 'png' };
		Body: { svgContent: string };
	}>,
	reply: FastifyReply,
) => {
	const { format } = request.params;
	const { data, error } = await vectorizeService.exportFormat(
		request.body.svgContent,
		format,
	);
	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}
	if (!data) return reply.status(500).send({ message: 'Export failed' });
	reply.header('Content-Type', data.mimetype);
	return reply.send(data.content);
};
