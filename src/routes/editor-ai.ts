import type { FastifyInstance } from 'fastify';
import {
	editorAiController,
	editorApplyColorController,
	editorRemoveBackgroundController,
} from '../controllers/editor-ai.js';
import { authenticateCustomer } from '../middleware/auth.js';
import {
	applyColorRequestSchema,
	applyColorResponseSchema,
	editorAiRequestSchema,
	editorAiResponseSchema,
	removeBackgroundRequestSchema,
	removeBackgroundResponseSchema,
} from '../types/editor-ai.js';
import { ErrorSchema } from '../types/error.js';

export async function editorAiRoute(server: FastifyInstance) {
	// ── /editor/ai — Gemini via OpenRouter (generate / edit / inpaint) ─────
	server.post(
		'/editor/ai',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description: [
					'Proxy para o modelo de imagem (Gemini 3 Pro Image / Nano Banana 2) via OpenRouter.',
					'Suporta 3 modos:',
					'- `generate` (default): cria imagem a partir de prompt',
					'- `edit`: edita imagem existente (campo `image` obrigatório)',
					'- inpainting: ative passando `regionInfo` ou `mask` junto com `image`',
				].join('\n'),
				body: editorAiRequestSchema,
				response: {
					200: editorAiResponseSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					429: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Editor AI'],
				security: [{ bearerAuth: [] }],
			},
		},
		editorAiController,
	);

	// ── /editor/remove-background — Gemini via OpenRouter ─────────────────
	server.post(
		'/editor/remove-background',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Remove o fundo da imagem usando o mesmo modelo Gemini 3 Pro Image (Nano Banana 2) já configurado pra /previas/generate e /editor/ai. Reusa OPENROUTER_API_KEY, sem deps nativas. Retorna PNG com fundo transparente.',
				body: removeBackgroundRequestSchema,
				response: {
					200: removeBackgroundResponseSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					429: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Editor AI'],
				security: [{ bearerAuth: [] }],
			},
		},
		editorRemoveBackgroundController,
	);

	// ── /editor/apply-color — Sharp pixel tint ────────────────────────────
	server.post(
		'/editor/apply-color',
		{
			preHandler: [authenticateCustomer],
			schema: {
				description:
					'Aplica cor sólida (targetColor hex) em todos os pixels não-transparentes. Substitui o Jimp do porteira por Sharp (mais leve, comportamento idêntico).',
				body: applyColorRequestSchema,
				response: {
					200: applyColorResponseSchema,
					400: ErrorSchema,
					403: ErrorSchema,
					500: ErrorSchema,
				},
				tags: ['Editor AI'],
				security: [{ bearerAuth: [] }],
			},
		},
		editorApplyColorController,
	);
}
