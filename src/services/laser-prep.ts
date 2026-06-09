import crypto from 'node:crypto';
import { laserPrep } from '../lib/laser-prep.js';
import { withCapture } from '../lib/sentry.js';
import { uploadLaserPrepPng } from '../lib/storage.js';
import type { LaserPrepParams } from '../types/laser-prep.js';

interface LaserPrepInput {
	buffer: Buffer;
	filename: string;
	mimetype: string;
	params: LaserPrepParams;
	invocationId?: string | null;
	authHeader?: string;
}

/**
 * Higieniza o nome enviado pelo cliente antes de compor o path no storage.
 * Pega só o basename, colapsa sequências de "." e troca tudo fora de
 * [A-Za-z0-9._-] por "_" — impede path traversal (ex.: "../../x") no Bunny.
 * O UUID no path já garante unicidade; isto mantém um nome legível e seguro.
 */
function sanitizeFilename(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? '';
	const safe = base
		.replace(/\.\.+/g, '.')
		.replace(/[^\w.-]/g, '_')
		.slice(0, 80);
	return safe.length > 0 ? safe : 'image';
}

export const laserPrepService = {
	async prepare(customerId: string, input: LaserPrepInput) {
		return withCapture(async () => {
			const { buffer, filename, params } = input;
			const id = crypto.randomUUID();
			const safeName = sanitizeFilename(filename);

			// Roda o motor de fotogravação (porte do ImagR One Click).
			const result = await laserPrep(buffer, params);

			// Sobe o PNG (Bunny) e devolve também inline (base64) pro front.
			const pngUrl = await uploadLaserPrepPng(
				result.pngBuffer,
				`${customerId}/${id}_${safeName}.png`,
			);
			const pngBase64 = `data:image/png;base64,${result.pngBuffer.toString(
				'base64',
			)}`;

			return {
				id,
				pngUrl,
				pngBase64,
				width_mm: result.widthMm,
				height_mm: result.heightMm,
				dpi: result.dpi,
				px_w: result.pxW,
				px_h: result.pxH,
			};
		});
	},
};
