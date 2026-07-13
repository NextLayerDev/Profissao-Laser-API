import type { FastifyInstance } from 'fastify';
import { listImageModels } from '../controllers/image-models.js';
import { authenticate } from '../middleware/auth.js';

/**
 * `GET /api/image-models` — catálogo curado de modelos OpenRouter para o
 * seletor de modelo da Fábrica de Tools. Auth requerida (qualquer user
 * logado lê — não é dado sensível).
 */
export async function imageModelsRoute(app: FastifyInstance) {
	app.get('/api/image-models', { preHandler: [authenticate] }, listImageModels);
}
