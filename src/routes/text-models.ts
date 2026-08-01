import type { FastifyInstance } from 'fastify';
import { listTextModels } from '../controllers/text-models.js';
import { authenticate } from '../middleware/auth.js';

/**
 * `GET /api/text-models` — catálogo curado de modelos OpenRouter de TEXTO para
 * o seletor da Fábrica de Tools (espelho de `/api/image-models`). Auth
 * requerida (qualquer user logado lê — não é dado sensível).
 */
export async function textModelsRoute(app: FastifyInstance) {
	app.get('/api/text-models', { preHandler: [authenticate] }, listTextModels);
}
