import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { invertSvgBoundedBySilhouette } from '../src/lib/svg-invert-bounded.js';
import { rasterizeSvgToPng } from '../src/lib/svg-raster.js';
import { buildSilhouetteContourSvg } from '../src/lib/svg-silhouette-contour.js';
import {
	parseVectorizeParams,
	svgToDxf,
	vectorizeImage,
} from '../src/lib/vectorize.js';

/**
 * Smoke do VETOR INVERTIDO delimitado pela silhueta, com imagens REAIS.
 *
 * O que este script prova, e os testes sintéticos não podem: que num logo e
 * numa foto de verdade o invertido sai SEM o retângulo do viewBox, com o anel
 * fino abraçando a silhueta e sem nenhum pedaço da arte vazando pra fora da
 * moldura traçada. Roda o motor direto (sem HTTP/DB/storage).
 *
 * Uso:
 *   npx tsx scripts/_smoke-invert.ts <saida> <imagem:modo> [<imagem:modo>...]
 *
 * `modo`:
 *   logo        → trace normal + inversão geométrica delimitada
 *   logo-invert → trace com invert de pré-processamento (arte clara em fundo
 *                 escuro) + inversão geométrica delimitada
 *   photo       → dithering atkinson + negativo local por silhueta
 */

async function main() {
	const [outDir, ...specs] = process.argv.slice(2);
	if (!outDir || specs.length === 0) {
		console.error(
			'uso: npx tsx scripts/_smoke-invert.ts <saida> <imagem:modo>...',
		);
		process.exit(1);
	}
	mkdirSync(outDir, { recursive: true });

	for (const spec of specs) {
		const sep = spec.lastIndexOf(':');
		const imgPath = spec.slice(0, sep);
		const kind = spec.slice(sep + 1);
		const name = basename(imgPath)
			.replace(/\.[^.]+$/, '')
			.replace(/\s+/g, '_');
		const buffer = readFileSync(imgPath);

		const fields: Record<string, string> =
			kind === 'photo'
				? { subject: 'photo', ditherAlgorithm: 'atkinson' }
				: kind === 'logo-invert'
					? { subject: 'logo', invert: 'true' }
					: { subject: 'logo' };
		const params = parseVectorizeParams(fields);

		console.log(`\n── ${name} (${kind}) ──`);
		let t = Date.now();
		const svg = await vectorizeImage(buffer, params);
		console.log(`vetorização: ${Date.now() - t}ms, svg ${svg.length}b`);

		writeFileSync(join(outDir, `${name}_normal.svg`), svg);
		writeFileSync(
			join(outDir, `${name}_normal.png`),
			await rasterizeSvgToPng(svg, { maxDim: 1200, flattenWhite: true }),
		);

		t = Date.now();
		let invertedSvg: string;
		let label: string;
		if (kind === 'photo') {
			// Igual ao serviço: foto original + params → negativo re-ditherizado.
			const res = await buildSilhouetteContourSvg(svg, {
				originalImage: buffer,
				params,
			});
			if (res.ok === false) {
				console.error(`  INVERT RECUSADO: ${res.reason}`);
				continue;
			}
			invertedSvg = res.svg;
			label = 'silhouette';
		} else {
			const res = await invertSvgBoundedBySilhouette(svg);
			if (res.ok === false) {
				console.error(`  INVERT RECUSADO: ${res.reason}`);
				continue;
			}
			invertedSvg = res.svg;
			label = `geometric/${res.strategy}`;
		}
		console.log(
			`inversão (${label}): ${Date.now() - t}ms, svg ${invertedSvg.length}b`,
		);

		writeFileSync(join(outDir, `${name}_invertido.svg`), invertedSvg);
		writeFileSync(
			join(outDir, `${name}_invertido.png`),
			// Resolução nativa: reamostrar trama de dither cria moiré no preview.
			await rasterizeSvgToPng(invertedSvg, {
				maxDim: 2000,
				flattenWhite: true,
			}),
		);
		const dxf = svgToDxf(invertedSvg);
		writeFileSync(join(outDir, `${name}_invertido.dxf`), dxf);
		console.log(`dxf: ${(dxf.match(/LWPOLYLINE/g) ?? []).length} polilinhas`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
