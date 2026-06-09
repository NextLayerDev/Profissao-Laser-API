import { z } from 'zod';

/**
 * Resposta do motor genérico. `output` é a projeção de `definition.output` —
 * forma varia por tool (ex.: `{ primary, preview, meta, savable }`), por isso os
 * valores são `any` (o serializer não deve podar nada).
 */
export const toolRunResultSchema = z.object({
	id: z.string(),
	output: z.record(z.string(), z.any()),
});

export type ToolRunResult = z.infer<typeof toolRunResultSchema>;
