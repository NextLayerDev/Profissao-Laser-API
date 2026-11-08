// Dithering algorithms operating on a single-channel (grayscale) buffer.
// Input: 1-channel buffer (0-255). Output: 1-channel buffer binarized to 0/255.

export const DITHER_ALGORITHMS = [
	'floydSteinberg',
	'atkinson',
	'stucki',
	'jarvis',
	'sierra',
	'ordered',
	'halftone',
] as const;

export type DitherAlgorithm = (typeof DITHER_ALGORITHMS)[number];

export function isDitherAlgorithm(value: unknown): value is DitherAlgorithm {
	return (
		typeof value === 'string' &&
		(DITHER_ALGORITHMS as readonly string[]).includes(value)
	);
}

// Error-diffusion kernels: [dx, dy, weight]. Divisor normalizes the weights.
interface DiffusionKernel {
	divisor: number;
	cells: ReadonlyArray<readonly [number, number, number]>;
}

const DIFFUSION_KERNELS: Record<string, DiffusionKernel> = {
	floydSteinberg: {
		divisor: 16,
		cells: [
			[1, 0, 7],
			[-1, 1, 3],
			[0, 1, 5],
			[1, 1, 1],
		],
	},
	atkinson: {
		divisor: 8,
		cells: [
			[1, 0, 1],
			[2, 0, 1],
			[-1, 1, 1],
			[0, 1, 1],
			[1, 1, 1],
			[0, 2, 1],
		],
	},
	stucki: {
		divisor: 42,
		cells: [
			[1, 0, 8],
			[2, 0, 4],
			[-2, 1, 2],
			[-1, 1, 4],
			[0, 1, 8],
			[1, 1, 4],
			[2, 1, 2],
			[-2, 2, 1],
			[-1, 2, 2],
			[0, 2, 4],
			[1, 2, 2],
			[2, 2, 1],
		],
	},
	jarvis: {
		divisor: 48,
		cells: [
			[1, 0, 7],
			[2, 0, 5],
			[-2, 1, 3],
			[-1, 1, 5],
			[0, 1, 7],
			[1, 1, 5],
			[2, 1, 3],
			[-2, 2, 1],
			[-1, 2, 3],
			[0, 2, 5],
			[1, 2, 3],
			[2, 2, 1],
		],
	},
	sierra: {
		divisor: 32,
		cells: [
			[1, 0, 5],
			[2, 0, 3],
			[-2, 1, 2],
			[-1, 1, 4],
			[0, 1, 5],
			[1, 1, 4],
			[2, 1, 2],
			[-1, 2, 2],
			[0, 2, 3],
			[1, 2, 2],
		],
	},
};

function errorDiffusion(
	src: Buffer,
	width: number,
	height: number,
	kernel: DiffusionKernel,
	threshold: number,
): Buffer {
	// Work in float space to accumulate diffused error without clipping.
	const buf = new Float32Array(width * height);
	for (let i = 0; i < buf.length; i++) buf[i] = src[i];

	const out = Buffer.alloc(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = y * width + x;
			const old = buf[idx];
			const newVal = old >= threshold ? 255 : 0;
			out[idx] = newVal;
			const err = old - newVal;
			for (const [dx, dy, w] of kernel.cells) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
				buf[ny * width + nx] += (err * w) / kernel.divisor;
			}
		}
	}
	return out;
}

// 8x8 Bayer matrix (normalized to 0..1) for ordered dithering.
const BAYER_8 = [
	[0, 32, 8, 40, 2, 34, 10, 42],
	[48, 16, 56, 24, 50, 18, 58, 26],
	[12, 44, 4, 36, 14, 46, 6, 38],
	[60, 28, 52, 20, 62, 30, 54, 22],
	[3, 35, 11, 43, 1, 33, 9, 41],
	[51, 19, 59, 27, 49, 17, 57, 25],
	[15, 47, 7, 39, 13, 45, 5, 37],
	[63, 31, 55, 23, 61, 29, 53, 21],
];

// 6x6 clustered-dot matrix for a classic halftone look.
const HALFTONE_6 = [
	[34, 29, 17, 21, 30, 35],
	[28, 14, 9, 16, 20, 31],
	[13, 8, 4, 5, 15, 19],
	[12, 3, 0, 1, 10, 18],
	[27, 7, 2, 6, 23, 24],
	[33, 26, 11, 22, 25, 32],
];

function maskDither(
	src: Buffer,
	width: number,
	height: number,
	matrix: number[][],
	threshold: number,
): Buffer {
	const size = matrix.length;
	const levels = size * size;
	const out = Buffer.alloc(width * height);
	// Bias the per-pixel threshold around the requested threshold.
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = y * width + x;
			const t = ((matrix[y % size][x % size] + 0.5) / levels) * 255;
			const localThreshold = threshold + (t - 127.5);
			out[idx] = src[idx] >= localThreshold ? 255 : 0;
		}
	}
	return out;
}

export function applyDithering(
	source: Buffer,
	width: number,
	height: number,
	algorithm: DitherAlgorithm,
	threshold: number,
): Buffer {
	if (algorithm === 'ordered') {
		return maskDither(source, width, height, BAYER_8, threshold);
	}
	if (algorithm === 'halftone') {
		return maskDither(source, width, height, HALFTONE_6, threshold);
	}
	const kernel =
		DIFFUSION_KERNELS[algorithm] ?? DIFFUSION_KERNELS.floydSteinberg;
	return errorDiffusion(source, width, height, kernel, threshold);
}
