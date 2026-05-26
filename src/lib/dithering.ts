export type DitherAlgorithm =
	| 'floydSteinberg'
	| 'atkinson'
	| 'stucki'
	| 'jarvis'
	| 'sierra'
	| 'ordered'
	| 'halftone';

/**
 * Aplica algoritmo de dithering em pixels grayscale.
 * Retorna buffer binario (0 ou 255 por pixel).
 */
export function applyDithering(
	pixels: Buffer,
	width: number,
	height: number,
	algorithm: DitherAlgorithm,
	threshold = 128,
): Buffer {
	const floatPixels = new Float32Array(width * height);
	for (let i = 0; i < pixels.length; i++) {
		floatPixels[i] = pixels[i];
	}

	let result: Uint8Array;
	switch (algorithm) {
		case 'floydSteinberg':
			result = floydSteinberg(floatPixels, width, height, threshold);
			break;
		case 'atkinson':
			result = atkinson(floatPixels, width, height, threshold);
			break;
		case 'stucki':
			result = stucki(floatPixels, width, height, threshold);
			break;
		case 'jarvis':
			result = jarvis(floatPixels, width, height, threshold);
			break;
		case 'sierra':
			result = sierra(floatPixels, width, height, threshold);
			break;
		case 'ordered':
			result = orderedDither(floatPixels, width, height, threshold);
			break;
		case 'halftone':
			result = halftoneDither(floatPixels, width, height, threshold);
			break;
		default:
			result = floydSteinberg(floatPixels, width, height, threshold);
	}

	return Buffer.from(result);
}

function distributeError(
	pixels: Float32Array,
	w: number,
	h: number,
	x: number,
	y: number,
	error: number,
	kernel: Array<[number, number, number]>, // [dx, dy, weight]
) {
	for (const [dx, dy, weight] of kernel) {
		const nx = x + dx;
		const ny = y + dy;
		if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
			pixels[ny * w + nx] += error * weight;
		}
	}
}

// Floyd-Steinberg: erro-difusao padrao, 4 vizinhos, divisor 16
function floydSteinberg(
	pixels: Float32Array,
	w: number,
	h: number,
	threshold: number,
): Uint8Array {
	const output = new Uint8Array(w * h);
	const kernel: Array<[number, number, number]> = [
		[1, 0, 7 / 16],
		[-1, 1, 3 / 16],
		[0, 1, 5 / 16],
		[1, 1, 1 / 16],
	];

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const idx = y * w + x;
			const oldVal = Math.max(0, Math.min(255, pixels[idx]));
			const newVal = oldVal < threshold ? 0 : 255;
			output[idx] = newVal;
			distributeError(pixels, w, h, x, y, oldVal - newVal, kernel);
		}
	}
	return output;
}

// Atkinson: mais popular para laser — difunde apenas 75% do erro (alto contraste)
function atkinson(
	pixels: Float32Array,
	w: number,
	h: number,
	threshold: number,
): Uint8Array {
	const output = new Uint8Array(w * h);
	const kernel: Array<[number, number, number]> = [
		[1, 0, 1 / 8],
		[2, 0, 1 / 8],
		[-1, 1, 1 / 8],
		[0, 1, 1 / 8],
		[1, 1, 1 / 8],
		[0, 2, 1 / 8],
	];

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const idx = y * w + x;
			const oldVal = Math.max(0, Math.min(255, pixels[idx]));
			const newVal = oldVal < threshold ? 0 : 255;
			output[idx] = newVal;
			distributeError(pixels, w, h, x, y, oldVal - newVal, kernel);
		}
	}
	return output;
}

// Stucki: alta qualidade para fotos, kernel 12 vizinhos, divisor 42
function stucki(
	pixels: Float32Array,
	w: number,
	h: number,
	threshold: number,
): Uint8Array {
	const output = new Uint8Array(w * h);
	const kernel: Array<[number, number, number]> = [
		[1, 0, 8 / 42],
		[2, 0, 4 / 42],
		[-2, 1, 2 / 42],
		[-1, 1, 4 / 42],
		[0, 1, 8 / 42],
		[1, 1, 4 / 42],
		[2, 1, 2 / 42],
		[-2, 2, 1 / 42],
		[-1, 2, 2 / 42],
		[0, 2, 4 / 42],
		[1, 2, 2 / 42],
		[2, 2, 1 / 42],
	];

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const idx = y * w + x;
			const oldVal = Math.max(0, Math.min(255, pixels[idx]));
			const newVal = oldVal < threshold ? 0 : 255;
			output[idx] = newVal;
			distributeError(pixels, w, h, x, y, oldVal - newVal, kernel);
		}
	}
	return output;
}

// Jarvis-Judice-Ninke: kernel largo, gradientes suaves, divisor 48
function jarvis(
	pixels: Float32Array,
	w: number,
	h: number,
	threshold: number,
): Uint8Array {
	const output = new Uint8Array(w * h);
	const kernel: Array<[number, number, number]> = [
		[1, 0, 7 / 48],
		[2, 0, 5 / 48],
		[-2, 1, 3 / 48],
		[-1, 1, 5 / 48],
		[0, 1, 7 / 48],
		[1, 1, 5 / 48],
		[2, 1, 3 / 48],
		[-2, 2, 1 / 48],
		[-1, 2, 3 / 48],
		[0, 2, 5 / 48],
		[1, 2, 3 / 48],
		[2, 2, 1 / 48],
	];

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const idx = y * w + x;
			const oldVal = Math.max(0, Math.min(255, pixels[idx]));
			const newVal = oldVal < threshold ? 0 : 255;
			output[idx] = newVal;
			distributeError(pixels, w, h, x, y, oldVal - newVal, kernel);
		}
	}
	return output;
}

// Sierra (full): bom equilibrio qualidade/velocidade, divisor 32
function sierra(
	pixels: Float32Array,
	w: number,
	h: number,
	threshold: number,
): Uint8Array {
	const output = new Uint8Array(w * h);
	const kernel: Array<[number, number, number]> = [
		[1, 0, 5 / 32],
		[2, 0, 3 / 32],
		[-2, 1, 2 / 32],
		[-1, 1, 4 / 32],
		[0, 1, 5 / 32],
		[1, 1, 4 / 32],
		[2, 1, 2 / 32],
		[-1, 2, 2 / 32],
		[0, 2, 3 / 32],
		[1, 2, 2 / 32],
	];

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const idx = y * w + x;
			const oldVal = Math.max(0, Math.min(255, pixels[idx]));
			const newVal = oldVal < threshold ? 0 : 255;
			output[idx] = newVal;
			distributeError(pixels, w, h, x, y, oldVal - newVal, kernel);
		}
	}
	return output;
}

// Ordered dithering: matriz Bayer 8x8 (padrao estruturado, O(1) por pixel)
const BAYER_8X8 = [
	[0, 48, 12, 60, 3, 51, 15, 63],
	[32, 16, 44, 28, 35, 19, 47, 31],
	[8, 56, 4, 52, 11, 59, 7, 55],
	[40, 24, 36, 20, 43, 27, 39, 23],
	[2, 50, 14, 62, 1, 49, 13, 61],
	[34, 18, 46, 30, 33, 17, 45, 29],
	[10, 58, 6, 54, 9, 57, 5, 53],
	[42, 26, 38, 22, 41, 25, 37, 21],
];

function orderedDither(
	pixels: Float32Array,
	w: number,
	h: number,
	_threshold: number,
): Uint8Array {
	const output = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const idx = y * w + x;
			const val = Math.max(0, Math.min(255, pixels[idx]));
			const bayerVal = (BAYER_8X8[y % 8][x % 8] / 64) * 255;
			output[idx] = val > bayerVal ? 255 : 0;
		}
	}
	return output;
}

// Halftone: padrao de pontos tipo jornal (matriz radial 6x6)
const HALFTONE_6X6 = [
	[35, 30, 18, 22, 31, 36],
	[29, 15, 10, 12, 17, 28],
	[21, 9, 4, 6, 11, 23],
	[25, 13, 7, 1, 8, 20],
	[32, 19, 14, 16, 24, 34],
	[34, 27, 26, 3, 5, 2],
];

function halftoneDither(
	pixels: Float32Array,
	w: number,
	h: number,
	_threshold: number,
): Uint8Array {
	const output = new Uint8Array(w * h);
	const matrixSize = 6;
	const maxVal = 36;

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const idx = y * w + x;
			const val = Math.max(0, Math.min(255, pixels[idx]));
			const matrixVal =
				(HALFTONE_6X6[y % matrixSize][x % matrixSize] / maxVal) * 255;
			output[idx] = val > matrixVal ? 255 : 0;
		}
	}
	return output;
}
