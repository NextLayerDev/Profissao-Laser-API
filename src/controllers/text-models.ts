import type { FastifyReply, FastifyRequest } from 'fastify';
import { getTextModelsCatalog } from '../lib/text-models-catalog.js';

/**
 * GET /api/text-models
 * Catálogo curado de modelos OpenRouter para o bloco `ai.text`. Auth requerida
 * (qualquer user logado — não é dado sensível). `no-store` pelo mesmo motivo do
 * catálogo de imagem: o catálogo é editado por staff e o dropdown da Fábrica
 * precisa refletir a mudança na hora, não em até 1h (o TTL do cache in-process).
 */
export async function listTextModels(
	_req: FastifyRequest,
	reply: FastifyReply,
) {
	const data = getTextModelsCatalog();
	reply.header('Cache-Control', 'no-store').send(data);
}
