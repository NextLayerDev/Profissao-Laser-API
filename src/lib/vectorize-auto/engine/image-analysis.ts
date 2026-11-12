import sharp from 'sharp';

export interface ImageAnalysis {
	mean: number;
	stdev: number;
	min: number;
	max: number;
	width: number;
	height: number;
	otsuThreshold: number;
	contrastLevel: 'low' | 'medium' | 'high';
	isAlreadyBinary: boolean;
	hasGradient: boolean;
	hasComplexShading: boolean;
	hasMultipleColors: boolean;
	dominantColors: number;
	// Aurora routing signals
	bgLuminance: number;
	bgStdDev: number;
	isLightBackground: boolean;
	isDarkBackground: boolean;
	isUniformBackground: boolean;
	avgForegroundSaturation: number;
	foregroundCoverage: number;
	hasFineTex: boolean;
	sourceDpi: number;
	targetPixels: number;
	needsQualityUpscale: boolean;
	suggestedTurdSize: number;
	suggestedOptTolerance: number;
	suggestedAlphaMax: number;
	needsContrastEnhancement: boolean;
	suggestedMode: 'laser' | 'outline' | 'aurora';
}

/** Otsu's method: find threshold that maximizes inter-class variance */
function computeOtsuThreshold(
	histogram: number[],
	totalPixels: number,
): number {
	let bestThreshold = 128;
	let maxVariance = 0;

	let weightBg = 0;
	let sumBg = 0;
	let sumTotal = 0;

	for (let i = 0; i < 256; i++) {
		sumTotal += i * histogram[i];
	}

	for (let t = 0; t < 256; t++) {
		weightBg += histogram[t];
		if (weightBg === 0) continue;

		const weightFg = totalPixels - weightBg;
		if (weightFg === 0) break;

		sumBg += t * histogram[t];
		const meanBg = sumBg / weightBg;
		const meanFg = (sumTotal - sumBg) / weightFg;

		const variance = weightBg * weightFg * (meanBg - meanFg) ** 2;
		if (variance > maxVariance) {
			maxVariance = variance;
			bestThreshold = t;
		}
	}

	return bestThreshold;
}

/** Check if histogram is bimodal (two clear peaks) vs smooth gradient */
function isBimodal(histogram: number[], totalPixels: number): boolean {
	const lowBin = histogram.slice(0, 64).reduce((a, b) => a + b, 0);
	const highBin = histogram.slice(192).reduce((a, b) => a + b, 0);
	const midBin = histogram.slice(64, 192).reduce((a, b) => a + b, 0);

	return (lowBin + highBin) / totalPixels > 0.6 && midBin / totalPixels < 0.4;
}

interface ColorBgAnalysis {
	hasMultipleColors: boolean;
	dominantColors: number;
	bgLuminance: number;
	bgStdDev: number;
	isLightBackground: boolean;
	isDarkBackground: boolean;
	isUniformBackground: boolean;
	avgForegroundSaturation: number;
	foregroundCoverage: number;
	foregroundStdev: number;
}

/**
 * Single-pass analysis over a 100x100 thumbnail:
 * - Color clustering (from old detectMultiColor)
 * - Background brightness & uniformity (border pixels)
 * - Foreground saturation & coverage
 */
async function detectColorAndBackground(
	buffer: Buffer,
): Promise<ColorBgAnalysis> {
	// Early grayscale check via channel stats
	const stats = await sharp(buffer).stats();
	const isGrayscale =
		stats.channels.length >= 3 &&
		Math.max(
			stats.channels[0].mean,
			stats.channels[1].mean,
			stats.channels[2].mean,
		) -
			Math.min(
				stats.channels[0].mean,
				stats.channels[1].mean,
				stats.channels[2].mean,
			) <
			10 &&
		Math.max(
			stats.channels[0].stdev,
			stats.channels[1].stdev,
			stats.channels[2].stdev,
		) -
			Math.min(
				stats.channels[0].stdev,
				stats.channels[1].stdev,
				stats.channels[2].stdev,
			) <
			10;

	// Downsample to 100x100 for speed
	const { data, info } = await sharp(buffer)
		.resize(100, 100, { fit: 'inside' })
		.flatten({ background: '#ffffff' })
		.raw()
		.toBuffer({ resolveWithObject: true });

	const w = info.width;
	const h = info.height;
	const ch = info.channels;
	const totalSampled = w * h;

	// ── 1. Border pixel sampling (inset 5px to avoid JPEG artifacts) ──
	const inset = Math.max(2, Math.round(Math.min(w, h) * 0.05));
	const borderLums: number[] = [];

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const isBorder =
				y === inset ||
				y === h - inset - 1 ||
				x === inset ||
				x === w - inset - 1;
			if (!isBorder) continue;
			if (y < inset || y > h - inset - 1 || x < inset || x > w - inset - 1)
				continue;

			const idx = (y * w + x) * ch;
			const lum =
				0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
			borderLums.push(lum);
		}
	}

	let bgLuminance = 200;
	let bgStdDev = 0;
	if (borderLums.length > 0) {
		bgLuminance = borderLums.reduce((a, b) => a + b, 0) / borderLums.length;
		const variance =
			borderLums.reduce((sum, v) => sum + (v - bgLuminance) ** 2, 0) /
			borderLums.length;
		bgStdDev = Math.sqrt(variance);
	}

	const isLightBackground = bgLuminance > 180;
	const isDarkBackground = bgLuminance < 100;
	const isUniformBackground = bgStdDev < 30;

	// ── 2. Color clustering + foreground analysis (single scan) ──
	const buckets = new Map<number, number>();
	let fgCount = 0;
	let satSum = 0;
	let fgLumSum = 0;
	let fgLumSqSum = 0;

	for (let i = 0; i < data.length; i += ch) {
		const R = data[i],
			G = data[i + 1],
			B = data[i + 2];
		const lum = 0.299 * R + 0.587 * G + 0.114 * B;

		// Color bucketing
		const rB = Math.floor(R / 32);
		const gB = Math.floor(G / 32);
		const bB = Math.floor(B / 32);
		const key = rB * 64 + gB * 8 + bB;
		buckets.set(key, (buckets.get(key) || 0) + 1);

		// Foreground classification: > 40 luminance distance from background
		if (Math.abs(lum - bgLuminance) > 40) {
			fgCount++;
			fgLumSum += lum;
			fgLumSqSum += lum * lum;
			const cmax = Math.max(R, G, B);
			const cmin = Math.min(R, G, B);
			satSum += cmax === 0 ? 0 : ((cmax - cmin) / cmax) * 255;
		}
	}

	const foregroundCoverage = fgCount / totalSampled;
	const avgForegroundSaturation = fgCount > 0 ? satSum / fgCount : 0;
	const fgMean = fgCount > 0 ? fgLumSum / fgCount : 0;
	const foregroundStdev =
		fgCount > 10 ? Math.sqrt(fgLumSqSum / fgCount - fgMean * fgMean) : 0;

	// ── 3. Distinct color counting (skip if grayscale) ──
	if (isGrayscale) {
		return {
			hasMultipleColors: false,
			dominantColors: 1,
			bgLuminance,
			bgStdDev,
			isLightBackground,
			isDarkBackground,
			isUniformBackground,
			avgForegroundSaturation,
			foregroundCoverage,
			foregroundStdev,
		};
	}

	const significantBuckets = [...buckets.entries()]
		.filter(([, count]) => count / totalSampled > 0.02)
		.sort((a, b) => b[1] - a[1]);

	// Ignore background (largest bucket)
	const foregroundBuckets = significantBuckets.slice(1);

	let distinctColors = 0;
	const counted: number[] = [];

	for (const [key] of foregroundBuckets) {
		const r2 = Math.floor(key / 64) * 32 + 16;
		const g2 = Math.floor((key % 64) / 8) * 32 + 16;
		const b2 = (key % 8) * 32 + 16;

		const isDistinct = counted.every((ck) => {
			const cr = Math.floor(ck / 64) * 32 + 16;
			const cg = Math.floor((ck % 64) / 8) * 32 + 16;
			const cb = (ck % 8) * 32 + 16;
			const dist = Math.sqrt((r2 - cr) ** 2 + (g2 - cg) ** 2 + (b2 - cb) ** 2);
			return dist > 80;
		});

		if (isDistinct) {
			distinctColors++;
			counted.push(key);
		}
	}

	return {
		hasMultipleColors: distinctColors >= 2,
		dominantColors: Math.max(1, distinctColors),
		bgLuminance,
		bgStdDev,
		isLightBackground,
		isDarkBackground,
		isUniformBackground,
		avgForegroundSaturation,
		foregroundCoverage,
		foregroundStdev,
	};
}

export async function analyzeImage(buffer: Buffer): Promise<ImageAnalysis> {
	// Pre-flatten alpha onto white — sharp's pipeline mis-optimizes
	// .flatten().grayscale().raw() for images with black RGB + alpha content,
	// producing all-white pixels. Two-step avoids the bug.
	const flatBuffer = await sharp(buffer)
		.flatten({ background: '#ffffff' })
		.toBuffer();
	const grayscale = sharp(flatBuffer).grayscale();

	// Get grayscale stats
	const stats = await grayscale.clone().stats();
	const { mean, stdev, min, max } = stats.channels[0];

	// Get image dimensions
	const meta = await sharp(buffer).metadata();
	const width = meta.width || 0;
	const height = meta.height || 0;

	// Get raw pixels for histogram
	const { data, info } = await grayscale
		.clone()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const totalPixels = info.width * info.height;

	// Build histogram
	const histogram = new Array(256).fill(0);
	for (let i = 0; i < data.length; i++) {
		histogram[data[i]]++;
	}

	// Otsu's threshold
	const otsuThreshold = computeOtsuThreshold(histogram, totalPixels);

	// Classification
	const range = max - min;
	const isAlreadyBinary =
		stdev > 120 &&
		min < 10 &&
		max > 245 &&
		(histogram[0] + histogram[255]) / totalPixels > 0.9;

	const contrastLevel: 'low' | 'medium' | 'high' =
		range > 200 ? 'high' : range < 100 ? 'low' : 'medium';

	const bimodal = isBimodal(histogram, totalPixels);

	const needsContrastEnhancement = contrastLevel === 'low';

	// Color + background detection (single pass)
	const {
		hasMultipleColors,
		dominantColors,
		bgLuminance,
		bgStdDev,
		isLightBackground,
		isDarkBackground,
		isUniformBackground,
		avgForegroundSaturation,
		foregroundCoverage,
		foregroundStdev,
	} = await detectColorAndBackground(buffer);

	// Gradient detection: check both overall stats AND foreground-only stats.
	// Small logos on large white canvases have low overall stdev (background dominates),
	// but foreground pixels reveal the actual gradient. Require saturation > 50 to
	// exclude B&W logos whose anti-aliasing creates foreground stdev without real color.
	const hasGradient =
		!isAlreadyBinary &&
		((!bimodal && stdev > 20 && stdev < 110) ||
			(foregroundCoverage > 0.03 &&
				foregroundStdev > 20 &&
				foregroundStdev < 110 &&
				avgForegroundSaturation > 50));

	// Complex shading: gradientes + multi-cor = 3D/extrusão/chanfro
	const hasComplexShading =
		(hasGradient && hasMultipleColors) ||
		(!bimodal && !isAlreadyBinary && stdev > 50 && dominantColors >= 2);

	// Fine text detection
	const hasFineTex =
		stdev > 40 && stdev < 120 && !isAlreadyBinary && !hasGradient;

	// DPI-based quality upscale
	const maxDim = Math.max(width, height);
	const sourceDpi =
		meta.density || (maxDim < 500 ? 72 : maxDim < 1000 ? 150 : 300);
	const targetPixels = Math.min(Math.round(maxDim * (500 / sourceDpi)), 4000);
	const needsQualityUpscale = targetPixels > maxDim && maxDim > 0;

	// Suggest params based on analysis
	let suggestedTurdSize: number;
	let suggestedOptTolerance: number;
	let suggestedAlphaMax: number;

	if (isAlreadyBinary) {
		suggestedTurdSize = 2;
		suggestedOptTolerance = 0.2;
		suggestedAlphaMax = 1.0;
	} else if (hasFineTex || hasMultipleColors) {
		suggestedTurdSize = 2;
		suggestedOptTolerance = 0.1;
		suggestedAlphaMax = 0.6;
	} else if (hasGradient) {
		suggestedTurdSize = 3;
		suggestedOptTolerance = 0.15;
		suggestedAlphaMax = 0.9;
	} else if (contrastLevel === 'high') {
		suggestedTurdSize = 5;
		suggestedOptTolerance = 0.3;
		suggestedAlphaMax = 1.0;
	} else {
		suggestedTurdSize = 3;
		suggestedOptTolerance = 0.2;
		suggestedAlphaMax = 0.9;
	}

	// Auto-routing: Aurora only for confirmed smooth gradients (fold detection).
	// 3D/metallic/complex logos → outline with optimized params (set in vectorize.ts).
	let suggestedMode: 'laser' | 'outline' | 'aurora';
	if (isAlreadyBinary) {
		suggestedMode = 'laser';
	} else if (
		isLightBackground &&
		isUniformBackground &&
		hasGradient &&
		foregroundCoverage > 0.05 &&
		foregroundCoverage < 0.7
	) {
		suggestedMode = 'aurora';
	} else {
		suggestedMode = 'outline';
	}

	console.log('Aurora routing:', {
		bgLuminance: bgLuminance.toFixed(1),
		bgStdDev: bgStdDev.toFixed(1),
		isLightBackground,
		isUniformBackground,
		avgFgSat: avgForegroundSaturation.toFixed(1),
		fgCoverage: foregroundCoverage.toFixed(3),
		dominantColors,
		suggestedMode,
	});

	return {
		mean,
		stdev,
		min,
		max,
		width,
		height,
		otsuThreshold,
		contrastLevel,
		isAlreadyBinary,
		hasGradient,
		hasComplexShading,
		hasMultipleColors,
		dominantColors,
		bgLuminance,
		bgStdDev,
		isLightBackground,
		isDarkBackground,
		isUniformBackground,
		avgForegroundSaturation,
		foregroundCoverage,
		hasFineTex,
		sourceDpi,
		targetPixels,
		needsQualityUpscale,
		suggestedTurdSize,
		suggestedOptTolerance,
		suggestedAlphaMax,
		needsContrastEnhancement,
		suggestedMode,
	};
}
