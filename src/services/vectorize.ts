import crypto from 'node:crypto';
import { withCapture } from '@/lib/sentry.js';
import {
	uploadSvgFile,
	uploadVectorOriginalImage,
	uploadVectorPng,
} from '../lib/storage.js';
import { generateDxf, preprocessImage } from '../lib/vectorize.js';
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

			const [{ svgContent, pngBuffer, width, height }, originalUrl] =
				await Promise.all([
					preprocessImage(buffer, params),
					uploadVectorOriginalImage(
						buffer,
						`${customerId}/${id}_original_${filename}`,
						mimetype,
					),
				]);

			const [svgUrl, pngUrl] = await Promise.all([
				uploadSvgFile(svgContent, `${customerId}/${id}_${filename}.svg`),
				uploadVectorPng(pngBuffer, `${customerId}/${id}_${filename}.png`),
			]);

			const dxfContent = generateDxf(width, height);

			const record = await vectorRepository.create(customerId, {
				original_name: filename,
				original_url: originalUrl,
				svg_url: svgUrl,
				params: params as Record<string, unknown>,
				png_url: pngUrl,
			});

			return { ...record, dxfContent, pngUrl };
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

			// DXF: fetch SVG to get dimensions then generate
			const svgRes = await fetch(vector.svg_url);
			if (!svgRes.ok) throw new Error('Failed to fetch SVG');
			const svgText = await svgRes.text();

			const widthMatch = /width="(\d+)"/.exec(svgText);
			const heightMatch = /height="(\d+)"/.exec(svgText);
			const width = widthMatch ? Number(widthMatch[1]) : 800;
			const height = heightMatch ? Number(heightMatch[1]) : 600;

			const dxfContent = generateDxf(width, height);
			return {
				type: 'content' as const,
				content: dxfContent,
				mimetype: 'application/dxf',
				filename: `${vector.original_name}.dxf`,
			};
		});
	},
};
