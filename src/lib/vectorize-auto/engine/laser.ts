// Clean single-color silhouette path for laser engraving (EZCAD-friendly).
//
// The full-color (VTracer) engine stacks filled color layers and reproduces
// edge anti-aliasing as thin bands. Inside galvo software like EZCAD that
// "explodes": curves become thousands of micro-segments with overlapping /
// self-intersecting contours. For engraving we instead binarize the image
// cleanly (auto background detection + Otsu threshold + despeckle) and trace
// it with Potrace, which yields a single, smooth, non-overlapping contour with
// correct holes (even-odd) — the equivalent of Weld + Reduce Nodes in CorelDRAW.

import sharp from 'sharp';

export interface LaserPreprocessOptions {
	threshold: number | null; // null → Otsu auto
	invert: boolean | null; // null → auto-detect from background corners
	despeckle: boolean; // median(3) to drop isolated noise pixels
	blur: number | null;
}

// Otsu's method: pick the threshold that maximizes between-class variance of a
// single-channel (grayscale) histogram. Removes the anti-aliasing transition
// pixels that would otherwise become separate edge contours.
export function computeOtsuThreshold(gray: Buffer): number {
	const hist = new Array(256).fill(0);
	for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

	const total = gray.length;
	if (total === 0) return 128;

	let sum = 0;
	for (let t = 0; t < 256; t++) sum += t * hist[t];

	let sumB = 0;
	let wB = 0;
	let maxVar = -1;
	let threshold = 128;

	for (let t = 0; t < 256; t++) {
		wB += hist[t];
		if (wB === 0) continue;
		const wF = total - wB;
		if (wF === 0) break;
		sumB += t * hist[t];
		const mB = sumB / wB;
		const mF = (sum - sumB) / wF;
		const between = wB * wF * (mB - mF) * (mB - mF);
		if (between > maxVar) {
			maxVar = between;
			threshold = t;
		}
	}
	return threshold;
}

// Sample the four corners (small patches) of an RGBA buffer to decide whether
// the background is dark. Transparent corners count as a light (paper)
// background. Used to auto-orient the trace so the MARK is traced, not the
// surrounding background (e.g. white logo on a black plate).
export function detectBackgroundIsDark(
	rgba: Buffer,
	width: number,
	height: number,
	channels: number,
): boolean {
	if (width === 0 || height === 0) return false;
	const patch = Math.max(1, Math.floor(Math.min(width, height) * 0.04));
	const corners: Array<[number, number]> = [
		[0, 0],
		[width - patch, 0],
		[0, height - patch],
		[width - patch, height - patch],
	];

	let lumSum = 0;
	let count = 0;
	for (const [cx, cy] of corners) {
		for (let dy = 0; dy < patch; dy++) {
			for (let dx = 0; dx < patch; dx++) {
				const x = Math.min(width - 1, cx + dx);
				const y = Math.min(height - 1, cy + dy);
				const idx = (y * width + x) * channels;
				const a = channels >= 4 ? rgba[idx + 3] : 255;
				if (a < 16) {
					lumSum += 255; // transparent → treat as light background
				} else {
					const r = rgba[idx];
					const g = channels >= 2 ? rgba[idx + 1] : r;
					const b = channels >= 3 ? rgba[idx + 2] : r;
					lumSum += 0.299 * r + 0.587 * g + 0.114 * b;
				}
				count++;
			}
		}
	}
	return count > 0 && lumSum / count < 128;
}

function extractGrayChannel(data: Buffer, channels: number): Buffer {
	if (channels === 1) return data;
	const out = Buffer.allocUnsafe(Math.floor(data.length / channels));
	for (let i = 0, j = 0; i < data.length; i += channels, j++) out[j] = data[i];
	return out;
}

// Produce a crisp bilevel PNG where the mark is black on white. Returns the
// threshold actually used and whether the image was inverted (for diagnostics).
export async function preprocessLaserToFile(
	buffer: Buffer,
	opts: LaserPreprocessOptions,
	outputPath: string,
): Promise<{ threshold: number; inverted: boolean }> {
	// Background orientation: decide light vs dark from the corners (with alpha).
	let inverted: boolean;
	if (opts.invert !== null) {
		inverted = opts.invert;
	} else {
		const { data, info } = await sharp(buffer, { failOn: 'none' })
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		inverted = detectBackgroundIsDark(
			data,
			info.width,
			info.height,
			info.channels,
		);
	}

	// Flatten transparency onto the background color we're treating as "paper",
	// then grayscale + optional cleanup. Negate when the mark is light-on-dark so
	// the mark ends up dark for Potrace's black-on-white tracing.
	let pipeline = sharp(buffer, { failOn: 'none' })
		.flatten({ background: inverted ? '#000000' : '#ffffff' })
		.grayscale();
	if (opts.blur !== null) pipeline = pipeline.blur(opts.blur);
	if (opts.despeckle) pipeline = pipeline.median(3);
	if (inverted) pipeline = pipeline.negate();

	const { data, info } = await pipeline
		.raw()
		.toBuffer({ resolveWithObject: true });
	const gray = extractGrayChannel(data, info.channels);
	const threshold = opts.threshold ?? computeOtsuThreshold(gray);

	await sharp(gray, {
		raw: { width: info.width, height: info.height, channels: 1 },
	})
		.threshold(threshold)
		.png()
		.toFile(outputPath);

	return { threshold, inverted };
}

// Round every numeric coordinate inside path `d` attributes to `precision`
// decimals, dropping redundant digits so the SVG stays compact and EZCAD reads
// clean curves.
export function roundPathCoords(svg: string, precision: number): string {
	return svg.replace(/\bd="([^"]*)"/g, (_match, d: string) => {
		const rounded = d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (n: string) => {
			const v = parseFloat(n);
			if (!Number.isFinite(v)) return n;
			return String(parseFloat(v.toFixed(precision)));
		});
		return `d="${rounded}"`;
	});
}
