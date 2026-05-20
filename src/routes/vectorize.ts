import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { vectorizeController } from '@/controllers/vectorize.js';
import { authenticateVectorizacao } from '@/middleware/auth.js';
import { ErrorSchema } from '@/types/error.js';
import { vectorSchema } from '@/types/vector.js';

export async function vectorizeRoute(server: FastifyInstance) {
	server.post(
		'/vectorize',
		{
			preHandler: [authenticateVectorizacao],
			schema: {
				description: `Recebe uma imagem (PNG, JPG ou WEBP) via multipart/form-data e retorna o SVG vetorizado.

**Campos do form:**
- \`file\` *(obrigatório)*: arquivo de imagem (PNG, JPG ou WEBP, máx 10 MB)
- \`save\` *(opcional, string "true"/"false")*: se "true", persiste o SVG no CDN e retorna o registro salvo (requer autenticação de cliente); caso contrário retorna o SVG diretamente com \`Content-Type: image/svg+xml\``,
				consumes: ['multipart/form-data'],
				response: {
					200: z.string().describe('SVG vetorizado (quando save não é "true")'),
					201: vectorSchema.describe(
						'Registro salvo na biblioteca do cliente (quando save="true")',
					),
					400: ErrorSchema,
					403: ErrorSchema,
					415: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Vectors'],
				security: [{ bearerAuth: [] }],
			},
		},
		vectorizeController,
	);
}
