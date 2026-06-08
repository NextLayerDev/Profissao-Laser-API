import crypto from 'node:crypto';
import sharp from 'sharp';
import { withCapture } from '@/lib/sentry.js';
import {
	uploadSvgFile,
	uploadVectorOriginalImage,
	uploadVectorPng,
} from '../lib/storage.js';
import { svgToDxf, vectorizeImage } from '../lib/vectorize.js';
import { vectorRepository } from '../repositories/vector.js';
import type { VectorizeParams } from '../types/vector.js';

interface VectorizeInput {
	buffer: Buffer;
	filename: string;
	mimetype: string;
	params: VectorizeParams;
}

export const vectorizeService = {
	async vectorize(customerId: string, input: VectorizeInput) {
		return withCapture(async () => {
			const { buffer, filename, mimetype, params } = input;
			const id = crypto.randomUUID();

			// Vetoriza (motor Potrace) + sobe o original em paralelo
			const [svgContent, originalUrl] = await Promise.all([
				vectorizeImage(buffer, params),
				uploadVectorOriginalImage(
					buffer,
					`${customerId}/${id}_original_${filename}`,
					mimetype,
				),
			]);

			// PNG = rasterização do SVG vetorizado (preview/download)
			const pngBuffer = await sharp(Buffer.from(svgContent)).png().toBuffer();

			const [svgUrl, pngUrl] = await Promise.all([
				uploadSvgFile(svgContent, `${customerId}/${id}_${filename}.svg`),
				uploadVectorPng(pngBuffer, `${customerId}/${id}_${filename}.png`),
			]);

			const dxfContent = svgToDxf(svgContent);

			const record = await vectorRepository.create(customerId, {
				original_name: filename,
				original_url: originalUrl,
				svg_url: svgUrl,
				params: params as Record<string, unknown>,
				png_url: pngUrl,
			});

			// Retorna o SVG inline (corrige o contrato com o front: preview/baixar/salvar)
			return {
				...record,
				svgContent,
				originalName: filename,
				isColor: params.mode === 'posterize',
				svgUrl,
				pngUrl,
				dxfContent,
			};
		});
	},

	async vectorizeBatch(customerId: string, inputs: VectorizeInput[]) {
		return withCapture(async () => {
			const settled = await Promise.allSettled(
				inputs.map((input) => vectorizeService.vectorize(customerId, input)),
			);

			const results = settled.map((r) =>
				r.status === 'fulfilled' ? r.value.data : null,
			);

			const succeeded = results.filter(Boolean).length;

			return {
				results: results.filter(Boolean),
				total: inputs.length,
				succeeded,
				failed: inputs.length - succeeded,
			};
		});
	},

	async exportVector(
		vectorId: string,
		customerId: string | null,
		format: 'dxf' | 'png',
	) {
		return withCapture(async () => {
			const vector = await vectorRepository.findByIdForExport(
				vectorId,
				customerId,
			);

			if (format === 'png') {
				const pngUrl =
					(vector as unknown as { png_url?: string }).png_url ?? null;
				if (!pngUrl) throw new Error('PNG not available for this vector');
				return {
					type: 'redirect' as const,
					url: pngUrl,
					filename: `${vector.original_name}.png`,
				};
			}

			// DXF: busca o SVG salvo e converte os paths em LWPOLYLINE
			const svgRes = await fetch(vector.svg_url);
			if (!svgRes.ok) throw new Error('Failed to fetch SVG');
			const svgText = await svgRes.text();

			const dxfContent = svgToDxf(svgText);
			return {
				type: 'content' as const,
				content: dxfContent,
				mimetype: 'application/dxf',
				filename: `${vector.original_name}.dxf`,
			};
		});
	},
};
