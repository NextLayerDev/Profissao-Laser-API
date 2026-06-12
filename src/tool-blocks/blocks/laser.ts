import { z } from 'zod';
import { laserPrep } from '../../lib/laser-prep.js';
import { laserPrepParamsSchema } from '../../types/laser-prep.js';
import type { ToolBlock } from '../types.js';

/**
 * `laser.photoengrave` — embrulha o motor de fotogravação (`laserPrep`, porte do
 * ImagR "One Click"). Reusa o `laserPrepParamsSchema` (material/width_mm/dpi/
 * dither/cleanBackground) e só acrescenta o buffer da imagem. Devolve o PNG (pra
 * upload), o base64 inline (preview) e as dimensões física/px.
 */
const photoengraveSchema = laserPrepParamsSchema.extend({
	image: z.instanceof(Buffer),
});

export const laserPhotoengraveBlock: ToolBlock<
	z.infer<typeof photoengraveSchema>
> = {
	id: 'laser.photoengrave',
	category: 'laser',
	description:
		'Prepara uma foto pra gravação a laser (tom por material, resize físico, dithering, PNG com DPI).',
	paramsSchema: photoengraveSchema,
	async run(_ctx, params) {
		const result = await laserPrep(params.image, params);
		return {
			png: result.pngBuffer,
			pngBase64: `data:image/png;base64,${result.pngBuffer.toString('base64')}`,
			width_mm: result.widthMm,
			height_mm: result.heightMm,
			dpi: result.dpi,
			px_w: result.pxW,
			px_h: result.pxH,
		};
	},
};
