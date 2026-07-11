import type { FastifyReply, FastifyRequest } from 'fastify';
import { getImageModelsCatalog } from '../lib/image-models-catalog.js';

/**
 * GET /api/image-models
 * Catálogo curado de modelos OpenRouter para `ai.generate_image`. Auth
 * requerida (qualquer user logado — não é dado sensível). Cache-Control de 1h
 * além do cache in-process 1h do `getImageModelsCatalog`.
 */
export async function listImageModels(
	_req: FastifyRequest,
	reply: FastifyReply,
) {
	const data = getImageModelsCatalog();
	reply.header('Cache-Control', 'private, max-age=3600').send(data);
}
