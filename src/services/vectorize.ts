import axios from 'axios';
import { withCapture } from '@/lib/sentry.js';
import { uploadSvgFile } from '../lib/storage.js';
import type { VectorizeParams } from '../types/vector.js';

const VECTORIZER_AI_API_KEY_ID = process.env.VECTORIZER_AI_API_KEY_ID ?? '';
const VECTORIZER_AI_API_SECRET_KEY =
	process.env.VECTORIZER_AI_API_SECRET_KEY ?? '';
const VECTORIZER_AI_URL = 'https://vectorizer.ai/api/v1/vectorize';

const DEFAULT_PARAMS: VectorizeParams = {
	mode: 'detailed',
	detailLevel: 50,
	smoothing: 50,
	noiseReduction: 20,
	blackAndWhite: false,
	invertColors: false,
};

function mergeParams(partial?: Partial<VectorizeParams>): VectorizeParams {
	return { ...DEFAULT_PARAMS, ...(partial ?? {}) };
}

function paramsToVectorizerForm(
	params: VectorizeParams,
): Record<string, string> {
	const form: Record<string, string> = {
		mode: 'production',
	};

	// Map our `mode` to Vectorizer.AI processing.shapes.layer_mode
	const layerMode =
		params.mode === 'contour'
			? 'cutout'
			: params.mode === 'fill'
				? 'stacked'
				: 'cutout';
	form['processing.shapes.layer_mode'] = layerMode;

	// detailLevel (0-100) → max_colors (2..32) for cutout/stacked
	const colors = params.blackAndWhite
		? 2
		: Math.max(2, Math.round((params.detailLevel / 100) * 32));
	form['processing.max_colors'] = String(colors);

	// smoothing (0-100) → output.curves.line_fit_tolerance (0.1..10)
	form['output.curves.line_fit_tolerance'] = (
		0.1 +
		(params.smoothing / 100) * 9.9
	).toFixed(2);

	// noiseReduction (0-100) → processing.shapes.minimum_area (px)
	form['processing.shapes.minimum_area'] = String(
		Math.round((params.noiseReduction / 100) * 50),
	);

	if (params.invertColors) {
		form['processing.palette'] = 'invert';
	}

	return form;
}

async function callVectorizerAi(
	imageBuffer: Buffer,
	mimetype: string,
	filename: string,
	params: VectorizeParams,
): Promise<{ svgContent: string }> {
	if (!VECTORIZER_AI_API_KEY_ID || !VECTORIZER_AI_API_SECRET_KEY) {
		throw new Error(
			'Vectorizer.AI credentials missing (VECTORIZER_AI_API_KEY_ID / VECTORIZER_AI_API_SECRET_KEY)',
		);
	}

	const form = new FormData();
	form.append('image', new Blob([imageBuffer], { type: mimetype }), filename);
	const extras = paramsToVectorizerForm(params);
	for (const [k, v] of Object.entries(extras)) form.append(k, v);

	const response = await axios.post(VECTORIZER_AI_URL, form, {
		auth: {
			username: VECTORIZER_AI_API_KEY_ID,
			password: VECTORIZER_AI_API_SECRET_KEY,
		},
		responseType: 'text',
		headers: { Accept: 'image/svg+xml' },
	});

	return { svgContent: response.data };
}

export const vectorizeService = {
	async vectorize(
		customerId: string,
		imageBuffer: Buffer,
		mimetype: string,
		filename: string,
		partialParams?: Partial<VectorizeParams>,
	) {
		return withCapture(async () => {
			const params = mergeParams(partialParams);
			const { svgContent } = await callVectorizerAi(
				imageBuffer,
				mimetype,
				filename,
				params,
			);

			const path = `${customerId}/${Date.now()}_${filename}.svg`;
			const svgUrl = await uploadSvgFile(svgContent, path);

			return {
				svgContent,
				svgUrl,
				dxfContent: null,
				dxfUrl: null,
				pngUrl: null,
				params,
			};
		});
	},

	async vectorizeBatch(
		customerId: string,
		files: Array<{ name: string; buffer: Buffer; mimetype: string }>,
		partialParams?: Partial<VectorizeParams>,
	) {
		return withCapture(async () => {
			const params = mergeParams(partialParams);
			const results = [];
			for (const f of files) {
				const { svgContent } = await callVectorizerAi(
					f.buffer,
					f.mimetype,
					f.name,
					params,
				);
				const path = `${customerId}/${Date.now()}_${f.name}.svg`;
				const svgUrl = await uploadSvgFile(svgContent, path);
				results.push({ name: f.name, svgContent, svgUrl, params });
			}
			return { results, params };
		});
	},

	async exportFormat(svgContent: string, format: 'svg' | 'dxf' | 'png') {
		return withCapture(async () => {
			if (format === 'svg') {
				return { content: svgContent, mimetype: 'image/svg+xml' };
			}
			// DXF/PNG conversion not implemented — would require a converter
			// (e.g. headless Chromium for PNG, an SVG→DXF lib for DXF).
			throw new Error(`Export to ${format} not implemented`);
		});
	},
};
