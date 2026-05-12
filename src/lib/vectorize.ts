import sharp from 'sharp';
import type { VectorizeParams } from '../types/vector.js';

export async function preprocessImage(
	buffer: Buffer,
	params: VectorizeParams,
): Promise<{
	svgContent: string;
	pngBuffer: Buffer;
	width: number;
	height: number;
}> {
	const meta = await sharp(buffer).metadata();
	const width = meta.width ?? 800;
	const height = meta.height ?? 600;

	let img = sharp(buffer);

	if (params.blackAndWhite) {
		img = img.grayscale();
	}

	if (params.invertColors) {
		img = img.negate({ alpha: false });
	}

	if (params.noiseReduction > 0) {
		const sigma = 0.3 + (params.noiseReduction / 100) * 2.7;
		img = img.blur(sigma);
	}

	if (params.smoothing > 0) {
		const sigma = 0.3 + (params.smoothing / 100) * 1.5;
		img = img.blur(sigma);
	}

	if (params.mode !== 'detalhado') {
		if (!params.blackAndWhite) {
			img = img.grayscale();
		}
		// detailLevel 0→threshold 192 (less detail), 100→threshold 64 (more detail)
		const threshold = Math.round(192 - (params.detailLevel / 100) * 128);
		img = img.threshold(threshold);
	}

	const pngBuffer = await img.png().toBuffer();
	const base64 = pngBuffer.toString('base64');
	const svgContent = buildEmbeddedSvg(base64, width, height);

	return { svgContent, pngBuffer, width, height };
}

function buildEmbeddedSvg(
	base64: string,
	width: number,
	height: number,
): string {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
		`     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
		`  <image x="0" y="0" width="${width}" height="${height}"`,
		`         xlink:href="data:image/png;base64,${base64}"/>`,
		'</svg>',
	].join('\n');
}

export function generateDxf(width: number, height: number): string {
	const w = (width / 96).toFixed(6);
	const h = (height / 96).toFixed(6);

	return [
		'0\nSECTION',
		'2\nHEADER',
		'9\n$ACADVER\n1\nAC1015',
		'9\n$DWGCODEPAGE\n3\nANSI_1252',
		'9\n$INSUNITS\n70\n1',
		`9\n$EXTMIN\n10\n0.0\n20\n0.0\n30\n0.0`,
		`9\n$EXTMAX\n10\n${w}\n20\n${h}\n30\n0.0`,
		'0\nENDSEC',
		'0\nSECTION',
		'2\nTABLES',
		'0\nTABLE\n2\nLAYER\n5\n2\n100\nAcDbSymbolTable\n70\n1',
		'0\nLAYER\n5\n10\n100\nAcDbSymbolTableRecord\n100\nAcDbLayerTableRecord',
		'2\n0\n70\n0\n62\n7\n6\nContinuous',
		'0\nENDTAB',
		'0\nENDSEC',
		'0\nSECTION',
		'2\nENTITIES',
		'0\nLWPOLYLINE',
		'8\n0',
		'100\nAcDbEntity',
		'100\nAcDbPolyline',
		'90\n4',
		'70\n1',
		'10\n0.0\n20\n0.0',
		`10\n${w}\n20\n0.0`,
		`10\n${w}\n20\n${h}`,
		`10\n0.0\n20\n${h}`,
		'0\nENDSEC',
		'0\nSECTION',
		'2\nOBJECTS',
		'0\nDICTIONARY\n5\nC\n100\nAcDbDictionary',
		'0\nENDSEC',
		'0\nEOF',
	].join('\n');
}

export function parseFormBoolean(value: unknown): boolean {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') return value === 'true' || value === '1';
	return false;
}
