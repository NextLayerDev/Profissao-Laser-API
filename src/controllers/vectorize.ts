import type { FastifyReply, FastifyRequest } from 'fastify';
import { vectorizeService } from '@/services/vectorize.js';

export const vectorizeController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	const customerId = request.currentCustomer?.id ?? null;

	// ── Parse multipart ────────────────────────────────────────────────────────
	let fileBuffer: Buffer | undefined;
	let filename = 'image';
	let mimetype = 'application/octet-stream';
	let save = false;

	const parts = request.parts();
	for await (const part of parts) {
		if (part.type === 'file' && part.fieldname === 'file') {
			fileBuffer = await part.toBuffer();
			filename = part.filename ?? 'image';
			mimetype = part.mimetype;
		} else if (part.type === 'field' && part.fieldname === 'save') {
			save = (part.value as string) === 'true';
		}
	}

	if (!fileBuffer) {
		return reply.status(400).send({ message: 'Campo "file" é obrigatório' });
	}

	const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp']);
	if (!ACCEPTED.has(mimetype)) {
		return reply
			.status(415)
			.send({ message: 'Tipo de imagem não suportado. Use PNG, JPG ou WEBP.' });
	}

	// ── Conversão ──────────────────────────────────────────────────────────────
	if (save) {
		if (!customerId) {
			return reply
				.status(400)
				.send({ message: 'customerId é necessário para salvar o vetor' });
		}

		const { data: vector, error } = await vectorizeService.convertAndSave(
			customerId,
			fileBuffer,
			mimetype,
			filename,
		);

		if (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			return reply.status(500).send({ message });
		}

		return reply.status(201).send(vector);
	}

	// Apenas retorna o SVG sem persistir
	const { data: svg, error } = await vectorizeService.convertOnly(
		fileBuffer,
		mimetype,
	);

	if (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return reply.status(500).send({ message });
	}

	return reply.status(200).header('Content-Type', 'image/svg+xml').send(svg);
};
