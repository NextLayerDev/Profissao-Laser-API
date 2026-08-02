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

/**
 * Resposta do preview NÃO cobrado. `preview` é a data URL da imagem; `assembly`
 * é a montagem 3D (`lib/cad/assembly.ts`) quando a tool é de CAD — o viewport
 * precisa dela, e ela não é imagem, então não cabe em `preview`.
 *
 * `assembly` é `z.any()` pelo mesmo motivo de `toolRunResultSchema.output`: o
 * serializer do `fastify-type-provider-zod` PODA em silêncio o que não está no
 * schema, e um schema nominal da montagem faria a resposta chegar mutilada (ou
 * vazia) no front a cada campo novo em `AssemblyPart`.
 */
export const toolPreviewResultSchema = z.object({
	preview: z.string().nullable(),
	assembly: z.any().optional(),
});

export type ToolPreviewResult = z.infer<typeof toolPreviewResultSchema>;
