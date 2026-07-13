import type { FastifyReply, FastifyRequest } from 'fastify';
import { getImageModelsCatalog } from '../lib/image-models-catalog.js';

/**
 * GET /api/image-models
 * Catálogo curado de modelos OpenRouter para `ai.generate_image`. Auth
 * requerida (qualquer user logado — não é dado sensível). `no-store`: o catálogo
 * é editado por staff e o dropdown da Fábrica precisa refletir mudanças na hora
 * (com cache de 1h, uma edição/deploy só aparecia até 1h depois).
 */
export async function listImageModels(
	_req: FastifyRequest,
	reply: FastifyReply,
) {
	const data = getImageModelsCatalog();
	reply.header('Cache-Control', 'no-store').send(data);
}
