import type { FastifyReply, FastifyRequest } from 'fastify';
import { vectorizeAdvanced } from '../lib/laseria.js';

const ALLOWED_MIME = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/svg+xml',
]);
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Vetorização avançada (modelo em teste) — staff only. Recebe 1 imagem
 * (multipart, campo `file`) e devolve o SVG. Sem cobrança.
 */
export const advancedVectorizeController = async (
	request: FastifyRequest,
	reply: FastifyReply,
) => {
	try {
		let buffer: Buffer | null = null;
		let filename = 'image';
		let mimetype = 'application/octet-stream';

		for await (const part of request.parts()) {
			if (part.type === 'file') {
				if (!ALLOWED_MIME.has(part.mimetype)) {
					await part.toBuffer();
					return reply.status(400).send({
						message: 'Tipo de imagem inválido (png/jpg/webp/gif/svg).',
					});
				}
				const buf = await part.toBuffer();
				if (buf.byteLength > MAX_SIZE) {
					return reply
						.status(400)
						.send({ message: 'Imagem grande demais (máx 10MB).' });
				}
				buffer = buf;
				filename = part.filename ?? 'image';
				mimetype = part.mimetype;
			}
		}

		if (!buffer) {
			return reply.status(400).send({ message: 'Imagem é obrigatória.' });
		}

		const { svgContent } = await vectorizeAdvanced(buffer, filename, mimetype);
		return reply.send({ svgContent });
	} catch (err) {
		const message =
			err instanceof Error ? err.message : 'Falha ao processar a imagem.';
		return reply.status(502).send({ message });
	}
};
