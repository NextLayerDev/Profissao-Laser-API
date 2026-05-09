import { z } from 'zod';

// ─── Editor AI (Gemini via OpenRouter) ────────────────────────────────────
// Mesmo body que system_porteira/src/app/api/editor-ai/route.ts:10-21

export const editorAiRegionSchema = z.object({
	x: z.number(),
	y: z.number(),
	width: z.number(),
	height: z.number(),
});

export const editorAiRequestSchema = z.object({
	prompt: z.string().min(1).max(8000),
	mode: z.enum(['generate', 'edit']).default('generate'),
	image: z.string().optional(), // data URL ou base64 puro
	mask: z.string().optional(), // data URL ou base64 puro (white=editar, black=manter)
	regionInfo: editorAiRegionSchema.optional(),
});

export type EditorAiRequest = z.infer<typeof editorAiRequestSchema>;

export const editorAiResponseSchema = z.object({
	imageBase64: z.string(),
});

// ─── Remove background (proxy remove.bg) ─────────────────────────────────

export const removeBackgroundRequestSchema = z.object({
	image: z.string().min(1), // data URL ou base64
});

export type RemoveBackgroundRequest = z.infer<
	typeof removeBackgroundRequestSchema
>;

export const removeBackgroundResponseSchema = z.object({
	imageBase64: z.string(),
});

// ─── Apply color (Sharp pixel tint) ───────────────────────────────────────

export const applyColorRequestSchema = z.object({
	image: z.string().min(1),
	targetColor: z
		.string()
		.regex(/^#?[0-9a-fA-F]{6}$/, 'Cor hex inválida (ex: #C0C0C0)'),
});

export type ApplyColorRequest = z.infer<typeof applyColorRequestSchema>;

export const applyColorResponseSchema = z.object({
	imageBase64: z.string(),
});
