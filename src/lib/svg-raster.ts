import sharp from 'sharp';

// ─────────────────────────────────────────────────────────────────────
// Rasterização de SVG pro pipeline de inversão. Isolado porque tem uma
// armadilha que quebra silenciosamente: `applySvgDimensions` reescreve
// width/height do SVG pra MILÍMETROS (ex.: "100mm") deixando o viewBox em
// pixels. O sharp então renderiza a 72dpi a partir do valor em mm e devolve um
// bitmap pequeno e errado. Normalizamos as dimensões pro sistema do viewBox
// antes de rasterizar.
// ─────────────────────────────────────────────────────────────────────

const MIN_RASTER = 512;
const MAX_RASTER = 2000;

/** viewBox do SVG, se declarado e válido. */
export function readViewBox(
	svg: string,
): { x: number; y: number; w: number; h: number } | null {
	const m = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
	if (!m) return null;
	const p = m[1].split(/[\s,]+/).map(Number);
	if (p.length !== 4 || !p.every((n) => Number.isFinite(n))) return null;
	if (p[2] <= 0 || p[3] <= 0) return null;
	return { x: p[0], y: p[1], w: p[2], h: p[3] };
}

/**
 * Força width/height às dimensões em px do viewBox, pra rasterização não ser
 * afetada por unidades físicas (mm) escritas pro laser.
 */
export function normalizeSvgForRaster(svg: string): string {
	const vb = readViewBox(svg);
	if (!vb) return svg;
	let out = svg;
	if (/\bwidth\s*=\s*"[^"]*"/i.test(out)) {
		out = out.replace(/\bwidth\s*=\s*"[^"]*"/i, `width="${vb.w}"`);
	} else {
		out = out.replace(/(<svg\b)/i, `$1 width="${vb.w}"`);
	}
	if (/\bheight\s*=\s*"[^"]*"/i.test(out)) {
		out = out.replace(/\bheight\s*=\s*"[^"]*"/i, `height="${vb.h}"`);
	} else {
		out = out.replace(/(<svg\b)/i, `$1 height="${vb.h}"`);
	}
	return out;
}

export interface RasterOptions {
	/** Lado maior alvo (clampado entre 512 e 2000). */
	maxDim?: number;
	/**
	 * Achata sobre branco. OBRIGATÓRIO no SVG invertido: ele é um campo preto
	 * com furos TRANSPARENTES; sem achatar, os furos saem transparentes em vez
	 * de brancos e o PNG não parece invertido.
	 */
	flattenWhite?: boolean;
}

/** SVG → PNG. */
export async function rasterizeSvgToPng(
	svg: string,
	opts: RasterOptions = {},
): Promise<Buffer> {
	const normalized = normalizeSvgForRaster(svg);
	const target = Math.min(
		MAX_RASTER,
		Math.max(MIN_RASTER, opts.maxDim ?? 1200),
	);
	let pipe = sharp(Buffer.from(normalized), { failOn: 'none' }).resize(
		target,
		target,
		{
			fit: 'inside',
			withoutEnlargement: false,
		},
	);
	if (opts.flattenWhite) pipe = pipe.flatten({ background: '#ffffff' });
	return pipe.png().toBuffer();
}

/** SVG → máscara binária de tinta (1 = escuro/tinta). */
export async function rasterizeSvgToInkMask(
	svg: string,
	maxDim: number,
): Promise<{ ink: Uint8Array; width: number; height: number }> {
	const png = await rasterizeSvgToPng(svg, { maxDim, flattenWhite: true });
	const { data, info } = await sharp(png)
		.grayscale()
		.toColourspace('b-w')
		.raw()
		.toBuffer({ resolveWithObject: true });
	const n = info.width * info.height;
	const ink = new Uint8Array(n);
	for (let i = 0; i < n; i++) ink[i] = data[i * info.channels] < 128 ? 1 : 0;
	return { ink, width: info.width, height: info.height };
}
