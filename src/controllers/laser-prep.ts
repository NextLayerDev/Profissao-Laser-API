import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseLaserPrepParams } from '../lib/laser-prep.js';
import {
	refundInvocation,
	resolveToolBilling,
	settleInvocation,
} from '../lib/upvox-tools.js';
import { laserPrepService } from '../services/laser-prep.js';

// Tipos de imagem aceitos no upload (alinhado ao que o sharp decodifica).
const ALLOWED_IMAGE_MIME = new Set([
	'image/png',
	'image/jpeg',
	'image/jpg',
	'image/webp',
	'image/gif',
	'image/bmp',
	'image/tiff',
	'image/avif',
]);

export const laserPrepController = async (
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
			'gravacao_oneclick',
			fields.invocation_id ?? null,
			authHeader,
		);
		if (gate.mode === 'reject') {
			return reply.status(gate.status).send({ message: gate.message });
		}
		invocationId = gate.mode === 'paid' ? gate.invocationId : null;

		// Falha rápida em tipo não-imagem: evita gastar CPU no sharp e devolve um
		// 400 claro (com refund) em vez do 500 genérico. O sharp já rejeita
		// não-imagem mais adiante; isto é a primeira barreira (mimetype é
		// spoofável, então é defense-in-depth, não garantia de segurança).
		if (!ALLOWED_IMAGE_MIME.has(mimetype)) {
			if (invocationId)
				await refundInvocation(customerId, invocationId, authHeader);
			return reply.status(400).send({
				message: 'Tipo de arquivo não suportado (envie PNG/JPG/WEBP).',
			});
		}

		const params = parseLaserPrepParams(fields);
		const { data: result, error } = await laserPrepService.prepare(customerId, {
			buffer: fileBuffer,
			filename,
			mimetype,
			params,
			invocationId,
			authHeader,
		});

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
