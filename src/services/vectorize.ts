import { createRequire } from 'node:module';
import sharp from 'sharp';
import { withCapture } from '@/lib/sentry.js';
import { uploadSvgFile } from '@/lib/storage.js';
import { vectorRepository } from '@/repositories/vector.js';

// potrace é CommonJS; usa createRequire para importar dentro de ESM
const require = createRequire(import.meta.url);
const potrace = require('potrace') as {
	trace: (
		src: Buffer,
		opts: Record<string, unknown>,
		cb: (err: Error | null, svg: string) => void,
	) => void;
};

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Converte PNG/JPG/WEBP para SVG usando sharp (normalização) + potrace (tracing).
 */
async function imageToSvg(
	imageBuffer: Buffer,
	mimetype: string,
): Promise<string> {
	if (!ALLOWED_MIME_TYPES.has(mimetype)) {
		throw new Error(
			`Tipo de imagem não suportado: ${mimetype}. Aceitos: PNG, JPG, WEBP`,
		);
	}

	// Converte para PNG em escala de cinza — potrace trabalha melhor assim
	const grayscalePng = await sharp(imageBuffer)
		.grayscale()
		.normalize()
		.png()
		.toBuffer();

	// potrace usa callback; promisificamos aqui
	const svg = await new Promise<string>((resolve, reject) => {
		potrace.trace(
			grayscalePng,
			{
				threshold: 128, // limiar de binarização (0-255)
				turdSize: 2, // remove manchas menores que N px² (ruído)
				alphaMax: 1, // suavidade dos cantos (0 = cantos vivos, 1.33 = curvas)
				optCurve: true, // otimiza curvas de Bézier
				optTolerance: 0.2,
			},
			(err, result) => {
				if (err) return reject(err);
				resolve(result);
			},
		);
	});

	return svg;
}

export const vectorizeService = {
	/** Converte a imagem e retorna apenas o SVG como string. */
	async convertOnly(imageBuffer: Buffer, mimetype: string) {
		return withCapture(() => imageToSvg(imageBuffer, mimetype));
	},

	/** Converte a imagem, faz upload do SVG e persiste o registro no banco. */
	async convertAndSave(
		customerId: string,
		imageBuffer: Buffer,
		mimetype: string,
		filename: string,
	) {
		return withCapture(async () => {
			const svgContent = await imageToSvg(imageBuffer, mimetype);

			const baseName = filename.replace(/\.[^.]+$/, '');
			const path = `${customerId}/${Date.now()}_${baseName}.svg`;
			const svgUrl = await uploadSvgFile(svgContent, path);

			return vectorRepository.create(customerId, {
				original_name: baseName,
				svg_url: svgUrl,
			});
		});
	},
};
