import { z } from 'zod';

// Chaves de material aceitas (mesmo conjunto de `MATERIAL_PRESETS` em
// `lib/laser-prep.ts`). Declaradas aqui para evitar dependência circular
// types↔lib no carregamento do módulo.
export const MATERIAL_KEYS = [
	'wood',
	'black slate',
	'glass',
	'acrylic',
	'leather',
	'cork',
	'andonized aluminum',
	'stainless steel',
	'white tile',
	'white tile painted black',
] as const;

// ─── Parâmetros do motor de fotogravação (Gravação 1-Clique) ─────────
// `material` resolve o perfil de tom/inversão/dithering. `width_mm` define o
// tamanho físico (altura recalculada pela proporção). `dpi` define a densidade
// de px. `noDither` desliga o dithering; `ditherAlgorithm` troca o algoritmo.
export const laserPrepParamsSchema = z.object({
	material: z.enum(MATERIAL_KEYS),
	// Limites físicos sãos: até 2 m de largura e 1200 DPI. Sem teto, um cliente
	// autenticado poderia pedir width_mm/dpi enormes (ex.: 10000 mm @ 2540 DPI =
	// 1.000.000 px) e estourar a memória do processo no resize (DoS).
	width_mm: z.number().positive().max(2000),
	dpi: z.number().int().positive().max(1200).default(254),
	noDither: z.boolean().optional(),
	ditherAlgorithm: z
		.enum([
			'floydSteinberg',
			'atkinson',
			'stucki',
			'jarvis',
			'sierra',
			'ordered',
			'halftone',
		])
		.optional(),
	// Limpeza de fundo claro (flood-fill das bordas, determinístico). `bgThreshold`
	// é o corte de luminância no cinza original (>= vira fundo candidato); default 200.
	cleanBackground: z.boolean().optional(),
	bgThreshold: z.number().int().min(0).max(255).default(200),
});

export type LaserPrepParams = z.infer<typeof laserPrepParamsSchema>;

export const laserPrepResultSchema = z.object({
	id: z.string().uuid(),
	pngUrl: z.string(),
	pngBase64: z.string(),
	width_mm: z.number(),
	height_mm: z.number(),
	dpi: z.number().int(),
	px_w: z.number().int(),
	px_h: z.number().int(),
});

export type LaserPrepResultDTO = z.infer<typeof laserPrepResultSchema>;
